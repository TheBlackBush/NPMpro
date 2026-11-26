import { rm, writeFile } from "node:fs/promises";
import { maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import { avatarExt, AVATAR_EXTS as avatarExts, fetchGravatar } from "../lib/gravatar.js";
import { MAIL_LANGUAGES } from "../lib/mail/settings-rules.js";
import { validateDefaultPermissions } from "../lib/oidc-rules.js";
import { rooted } from "../lib/paths.js";
import { withPasswordFlag } from "../lib/user-json.js";
import auditLogModel from "../models/audit-log.js";
import authModel from "../models/auth.js";
import userModel from "../models/user.js";
import userPermissionModel from "../models/user_permission.js";
import internalApiToken from "./api-token.js";
import internalAuditLog from "./audit-log.js";
import { createOidcIdentity } from "./oidc-identity.js";
import internalPasswordToken from "./password-token.js";
import internalToken from "./token.js";

const oidcIdentity = createOidcIdentity({
	knex: userModel.knex(),
	audit: (row) => auditLogModel.query().insert(row),
	tryBeginWrite: maintenance.tryBeginWrite,
});

// The one write of a password: the auth row, the end of every older session, and the end of the reset links and
// invitations that are still out. setPassword and setPasswordByReset share it.
const writePassword = async (trx, userId, type, secret) => {
	const existing_auth = await authModel.query(trx).where("user_id", userId).andWhere("type", type).first();

	if (existing_auth) {
		await authModel.query(trx).where("user_id", userId).andWhere("type", type).patch({
			type, // This is required for the model to encrypt on save
			secret,
		});
	} else {
		await authModel.query(trx).insert({ user_id: userId, type, secret, meta: {} });
	}

	await userModel
		.query(trx)
		.where("id", userId)
		.patch({ npmpro_token_valid_after: Math.floor(Date.now() / 1000) });
	await internalPasswordToken.removeForUser(trx, userId);
};

const internalUser = {
	/**
	 * Unauthenticated only once, and only while no active user exists; otherwise a valid auth method is required.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  data
	 * @returns {Promise}
	 */
	create: async (access, data) => {
		const auth = data.auth || null;
		delete data.auth;

		data.avatar ||= "";
		data.roles ||= [];

		data.email = data.email.toLowerCase();

		access.canAdmin();

		if (!(await internalUser.isEmailAvailable(data.email))) {
			throw new errs.ValidationError(`Email address already in use - ${data.email}`);
		}

		let user = await userModel.transaction(async (trx) => {
			const insertedUser = await userModel.query(trx).insertAndFetch(data);
			if (auth) {
				await authModel.query(trx).insert({
					user_id: insertedUser.id,
					type: auth.type,
					secret: auth.secret,
					meta: {},
				});
			}

			await userPermissionModel.query(trx).insert({
				user_id: insertedUser.id,
				visibility: data.roles.includes("admin") ? "all" : "user",
				proxy_hosts: "hidden",
				redirection_hosts: "hidden",
				dead_hosts: "hidden",
				streams: "hidden",
				access_lists: "hidden",
				certificates: "hidden",
			});

			return insertedUser;
		});

		await userModel
			.query()
			.findById(user.id)
			.patch({ avatar: await internalUser.fetchGravatar(user.id, user.email, user.name) });

		user = await internalUser.get(access, { id: user.id });

		await internalAuditLog.add(access, {
			action: "created",
			object_type: "user",
			object_id: user.id,
			meta: user,
		});

		return user;
	},

	// Gravatar on or off is read per call (advanced.gravatar)
	fetchGravatar: (id, email, name) => fetchGravatar(id, email, name),

	deleteAvatarFiles: async (id) => {
		for (const e of avatarExts) {
			await rm(rooted(`/data/public/avatar/${id}.${e}`), { force: true });
			await rm(rooted(`/data/public/gravatar/${id}.${e}`), { force: true });
		}
	},

	setAvatar: async (access, id, file) => {
		access.canUser(id);
		const ext = avatarExt(file?.buffer);
		if (!ext) throw new errs.ValidationError("Invalid avatar file type");
		const user = await internalUser.get(access, { id });
		await internalUser.deleteAvatarFiles(user.id);
		await writeFile(rooted(`/data/public/avatar/${user.id}.${ext}`), file.buffer);
		await userModel
			.query()
			.findById(user.id)
			.patch({ avatar: `/images/avatar/${user.id}.${ext}?v=${Date.now()}` });
		const savedUser = await internalUser.get(access, { id: user.id });

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "user",
			object_id: savedUser.id,
			meta: { ...savedUser, avatar_changed: true },
		});

		return savedUser;
	},

	/**
	 * The UI language of the signed-in user, for the language of their mails. A preference: no audit row.
	 *
	 * @param   {Access}  access
	 * @param   {String}  language  one of the 13 UI codes
	 * @returns {Promise}
	 */
	setLanguage: async (access, language) => {
		if (!MAIL_LANGUAGES.includes(language)) throw new errs.ValidationError("Unknown language");
		const id = access.token.getUserId(0);
		if (!id) throw new errs.PermissionError();
		await userModel.query().findById(id).patch({ npmpro_language: language });
	},

	deleteAvatar: async (access, id) => {
		access.canUser(id);
		const user = await internalUser.get(access, { id });
		for (const e of avatarExts) await rm(rooted(`/data/public/avatar/${user.id}.${e}`), { force: true });
		await userModel.query().findById(user.id).patch({ avatar: "" });
		return internalUser.update(access, { id: user.id });
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  [data.email]
	 * @param  {String}  [data.name]
	 * @return {Promise}
	 */
	update: async (access, data) => {
		access.canUser(data.id);
		if (data.roles !== undefined) access.canAdmin();
		if (data.id === access.token.getUserId(0) && (data.roles !== undefined || data.is_disabled !== undefined)) {
			throw new errs.PermissionError("You cannot change your own roles or disable yourself.");
		}
		const existingUser = await internalUser.get(access, { id: data.id });
		if (data.email !== undefined) {
			data.email = data.email.toLowerCase();

			if (existingUser.email !== data.email && !(await internalUser.isEmailAvailable(data.email, data.id))) {
				throw new errs.ValidationError(`Email address already in use - ${data.email}`);
			}
		}

		if (existingUser.avatar?.startsWith("/images/avatar/")) {
			data.avatar = existingUser.avatar;
		} else {
			data.avatar = await internalUser.fetchGravatar(
				existingUser.id,
				data.email || existingUser.email,
				data.name || existingUser.name,
			);
		}

		if (data.is_disabled) data.npmpro_token_valid_after = Math.floor(Date.now() / 1000);

		// a reset link went to the old address, and enabling the user again must not bring an old link back
		const endsLinks = data.is_disabled || (data.email !== undefined && data.email !== existingUser.email);
		await userModel.transaction(async (trx) => {
			await userModel.query(trx).findById(existingUser.id).patch(data);
			if (endsLinks) await internalPasswordToken.removeForUser(trx, existingUser.id);
		});
		const user = await internalUser.get(access, { id: data.id });

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "user",
			object_id: user.id,
			meta: user,
		});

		return user;
	},

	/**
	 * @param  {Access}   access
	 * @param  {Object}   [data]
	 * @param  {Integer}  [data.id]          Defaults to the token user
	 * @param  {Array}    [data.expand]
	 * @return {Promise}
	 */
	get: async (access, data) => {
		data.id ||= access.token.getUserId(0);

		access.canUser(data.id);

		const query = userModel.query().where("id", data.id).allowGraph("[permissions]").first();

		if (data.expand) query.withGraphFetched(`[${data.expand.join(", ")}]`);

		const row = await query;
		if (!row?.id) {
			throw new errs.ItemNotFoundError(data.id);
		}

		if (row.id === access.token.getUserId(0)) {
			row.goaccess = process.env.GOA === "true" && row.roles.includes("admin");
		}
		return row;
	},

	/**
	 * Whether the email is free, ignoring user_id when given.
	 *
	 * @param email
	 * @param user_id
	 */
	isEmailAvailable: async (email, user_id) => {
		const query = userModel.query().where("email", "=", email).first();

		if (user_id !== undefined) query.where("id", "!=", user_id);

		const user = await query;

		return !user;
	},

	/**
	 * @param {Access}  access
	 * @param {Object}  data
	 * @param {Integer} data.id
	 * @param {String}  [data.reason]
	 * @returns {Promise}
	 */
	delete: async (access, data) => {
		access.canAdmin();

		const user = await internalUser.get(access, { id: data.id });

		if (user.id === access.token.getUserId(0)) {
			throw new errs.PermissionError("You cannot delete yourself.");
		}

		await userModel.transaction(async (trx) => {
			await authModel.query(trx).where("user_id", user.id).delete();
			await userPermissionModel.query(trx).where("user_id", user.id).delete();
			await internalApiToken.deleteForUser(trx, user.id);
			await internalPasswordToken.removeForUser(trx, user.id);
			await userModel.query(trx).deleteById(user.id);
		});
		await internalUser.deleteAvatarFiles(user.id);

		await internalAuditLog.add(access, {
			action: "deleted",
			object_type: "user",
			object_id: user.id,
			meta: user,
		});

		return user;
	},

	/**
	 * @param   {Access}  access
	 * @param   {String}  [search_query]
	 * @returns {Promise}
	 */
	getAll: async (access, search_query) => {
		access.canAdmin();
		const query = userModel.query().groupBy("id").orderBy("name", "ASC");

		if (typeof search_query === "string") {
			query.where(function () {
				this.whereILike("name", `%${search_query}%`).orWhereILike("email", `%${search_query}%`);
			});
		}

		const [users, passwords] = await Promise.all([
			query,
			authModel.query().select("user_id").where("type", "password"),
		]);
		return withPasswordFlag(
			users.map((user) => user.toJSON()),
			passwords.map((row) => row.user_id),
		);
	},

	/**
	 * The password write of a reset link: the same transaction body as setPassword, without the current-password check
	 * (the link is the proof). Run it inside the transaction of the token's use, so a failed write leaves the link valid.
	 *
	 * @param  {Number}  userId
	 * @param  {String}  secret
	 * @param  {Object}  [trx]  the open transaction; without it the write has its own
	 * @return {Promise}
	 */
	setPasswordByReset: (userId, secret, trx) =>
		trx
			? writePassword(trx, userId, "password", secret)
			: userModel.transaction((own) => writePassword(own, userId, "password", secret)),

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @param  {Integer} data.id
	 * @param  {String}  data.type
	 * @param  {String}  data.secret
	 * @return {Promise}
	 */
	setPassword: async (access, data) => {
		access.canUser(data.id);

		const user = await internalUser.get(access, { id: data.id });

		if (user.id === access.token.getUserId(0)) {
			// they're setting their own password. Make sure their current password is correct
			if (!data.current) throw new errs.ValidationError("Current password was not supplied");

			await internalToken.getTokenFromEmail({
				identity: user.email,
				secret: data.current,
			});
		}

		await userModel.transaction((trx) => writePassword(trx, user.id, data.type, data.secret));

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "user",
			object_id: user.id,
			meta: {
				name: user.name,
				password_changed: true,
				auth_type: data.type,
			},
		});

		return true;
	},

	/**
	 * @param  {Access}  access
	 * @param  {Object}  data
	 * @return {Promise}
	 */
	setPermissions: async (access, data) => {
		access.canAdmin();

		const user = await internalUser.get(access, { id: data.id });

		let permissions;

		const { id, ...permissionData } = data;
		const existing_auth = await userPermissionModel.query().where("user_id", user.id).first();

		const merged = {
			visibility: "user",
			proxy_hosts: "hidden",
			redirection_hosts: "hidden",
			dead_hosts: "hidden",
			streams: "hidden",
			access_lists: "hidden",
			certificates: "hidden",
			...existing_auth,
			...permissionData,
		};
		const permissionError = validateDefaultPermissions(merged);
		if (permissionError) {
			throw new errs.ValidationError(permissionError);
		}

		if (existing_auth) {
			permissions = await userPermissionModel
				.query()
				.where("user_id", user.id)
				.patchAndFetchById(existing_auth.id, { user_id: user.id, ...permissionData });
		} else {
			permissions = await userPermissionModel.query().insertAndFetch({ user_id: user.id, ...merged });
		}

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "user",
			object_id: user.id,
			meta: {
				name: user.name,
				permissions,
			},
		});

		return true;
	},

	revokeSessions: async (access, userId) => {
		access.canUser(userId);
		const user = await userModel
			.query()
			.patchAndFetchById(userId, { npmpro_token_valid_after: Math.floor(Date.now() / 1000) });
		if (!user) throw new errs.ItemNotFoundError(userId);

		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "user",
			object_id: user.id,
			meta: {
				name: user.name,
				sessions_revoked: true,
			},
		});

		return true;
	},

	/**
	 * Removes the OIDC link: the next OIDC sign-in with this email links again. The DELETE request is a guarded write
	 * (lib/database/maintenance.js guard), so it needs no claim of its own.
	 *
	 * @param   {Access}   access
	 * @param   {Integer}  userId
	 * @returns {Promise<boolean>}
	 */
	unlinkOidc: async (access, userId) => {
		access.canAdmin();
		const user = await userModel.query().findById(userId);
		if (!user) throw new errs.ItemNotFoundError(userId);
		if (await oidcIdentity.unlink(user.id)) {
			await internalAuditLog.add(access, {
				action: "oidc-unlinked",
				object_type: "user",
				object_id: user.id,
				meta: { name: user.name, email: user.email },
			});
		}
		return true;
	},
};

export default internalUser;
