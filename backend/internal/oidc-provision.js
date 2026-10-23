import { newUserPermissions, OidcLoginError } from "../lib/oidc-login.js";
import { userNameFromClaims } from "../lib/oidc-rules.js";
import { oidc as logger } from "../logger.js";
import auditLogModel from "../models/audit-log.js";
import userModel from "../models/user.js";
import userPermissionModel from "../models/user_permission.js";
import internalUser from "./user.js";

// The email column has no unique index, so creations for the same email run one after another
const pending = new Map();

const findByEmail = (email, trx) =>
	userModel.query(trx).where("email", email).orderBy("is_disabled").orderBy("id").first();

const insertUser = async (email, name, permissions) => {
	const created = await userModel.transaction(async (trx) => {
		const existing = await findByEmail(email, trx);
		if (existing) return { user: existing, isNew: false };

		const user = await userModel.query(trx).insertAndFetch({
			email,
			name,
			avatar: "",
			roles: [],
			is_disabled: false,
		});
		await userPermissionModel.query(trx).insert({ user_id: user.id, ...permissions });
		return { user, isNew: true };
	});
	if (!created.isNew) return created.user;

	const { user } = created;
	await userModel
		.query()
		.findById(user.id)
		.patch({ avatar: await internalUser.fetchGravatar(user.id, user.email, user.name) });

	await auditLogModel.query().insert({
		user_id: user.id,
		action: "created",
		object_type: "user",
		object_id: user.id,
		meta: { name: user.name, email: user.email, via: "oidc" },
	});
	logger.info(`Created user ${user.id} for ${user.email}`);

	return userModel.query().findById(user.id);
};

export default {
	/**
	 * Creates a user without a password from the provider claims, or returns the
	 * user that already has this email
	 *
	 * @param   {Object}  claims       claims with a non-empty email
	 * @param   {Object}  permissions  auto_create.permissions
	 * @returns {Promise<Object>}      the user row
	 */
	createUser: async (claims, permissions) => {
		const checked = newUserPermissions(permissions);
		if (!checked.permissions) {
			logger.error(`Auto-create refused, the stored default permissions are invalid: ${checked.error}`);
			throw new OidcLoginError("provider_error", "Invalid default permissions");
		}

		const email = String(claims.email).toLowerCase().trim();
		const name = (String(userNameFromClaims({ ...claims, email })).trim() || email.split("@")[0]).slice(0, 255);

		const previous = pending.get(email) ?? Promise.resolve();
		const run = previous.catch(() => null).then(() => insertUser(email, name, checked.permissions));
		pending.set(email, run);
		try {
			return await run;
		} finally {
			if (pending.get(email) === run) pending.delete(email);
		}
	},
};
