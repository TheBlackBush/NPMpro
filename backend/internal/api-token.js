import { generateApiToken, TOKEN_PREFIX } from "../lib/api-token.js";
import { aboveOwner, isAdminUser, SECTIONS } from "../lib/api-token-permissions.js";
import { maintenance } from "../lib/database/maintenance.js";
import errs from "../lib/error.js";
import { global as logger } from "../logger.js";
import apiTokenModel from "../models/api_token.js";
import userModel from "../models/user.js";
import internalAuditLog from "./audit-log.js";

const USE_INTERVAL = 60;
const DEFAULT_DAYS = 90;
const DAY = 86_400;
const SWEEP_EVERY = 60 * 60 * 1000;

/** @returns {number} the time in epoch seconds */
const nowSeconds = () => Math.floor(Date.now() / 1000);

const iso = (seconds) => (seconds === null ? null : new Date(seconds * 1000).toISOString());

/** @returns {Object} the API form of a row: no hash, ISO times, whether it has expired */
const toPublic = (row, now = nowSeconds()) => ({
	id: row.id,
	name: row.name,
	prefix: `${TOKEN_PREFIX}${row.lookup_id}`,
	visibility: row.visibility,
	permissions: Object.fromEntries(SECTIONS.map((section) => [section, row[section]])),
	admin: row.is_admin,
	allow_delete: row.allow_delete,
	expires_on: iso(row.expires_on),
	last_used_on: iso(row.last_used_on),
	created_on: iso(row.created_on),
	expired: row.expires_on !== null && row.expires_on <= now,
});

/** @returns {?number} epoch seconds of the expiry: 90 days when not given, null for none */
const expiryOf = (value, now) => {
	if (value === undefined) return now + DEFAULT_DAYS * DAY;
	if (value === null) return null;
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) throw new errs.ValidationError("The expiry is not a valid date");
	const seconds = Math.floor(ms / 1000);
	if (seconds <= now) throw new errs.ValidationError("The expiry must be in the future");
	return seconds;
};

const ownOnly = (access, userId) => {
	if (Number(userId) !== access.token.getUserId(0))
		throw new errs.PermissionError("Tokens are managed by their owner");
};

const revoked = (access, row) =>
	internalAuditLog.add(access, {
		action: "revoked",
		object_type: "api-token",
		object_id: row.id,
		meta: { name: row.name, owner_id: row.user_id },
	});

const internalApiToken = {
	listOwn: async (access, userId) => {
		ownOnly(access, userId);
		const rows = await apiTokenModel
			.query()
			.where("user_id", userId)
			.orderBy("created_on", "DESC")
			.orderBy("id", "DESC");
		const now = nowSeconds();
		return rows.map((row) => toPublic(row, now));
	},

	create: async (access, userId, data) => {
		ownOnly(access, userId);
		const owner = await userModel.query().findById(userId).withGraphFetched("[permissions]");
		if (!owner) throw new errs.ItemNotFoundError(userId);
		const name = data.name.trim();
		if (name === "" || name.length > 100) throw new errs.ValidationError("The name must have 1 to 100 characters");
		const taken = await apiTokenModel.query().where("user_id", userId).select("name");
		if (taken.some((other) => other.name.toLowerCase() === name.toLowerCase())) {
			throw new errs.ValidationError("An API token with this name already exists");
		}
		if (data.admin === true && !isAdminUser(owner)) {
			throw new errs.PermissionError("Only administrators can create an Administrator token");
		}
		const requested = { visibility: data.visibility ?? "user", ...data.permissions };
		const above = aboveOwner(requested, owner);
		if (above.length > 0) {
			throw new errs.ValidationError(`A token cannot have more than its owner: ${above.join(", ")}`);
		}
		const now = nowSeconds();
		const made = generateApiToken();
		const row = await apiTokenModel.query().insertAndFetch({
			user_id: owner.id,
			name,
			lookup_id: made.lookupId,
			secret_hash: made.secretHash,
			visibility: requested.visibility,
			...Object.fromEntries(SECTIONS.map((section) => [section, requested[section]])),
			is_admin: data.admin === true,
			allow_delete: data.allow_delete === true,
			expires_on: expiryOf(data.expires_on, now),
			created_on: now,
		});
		const shown = toPublic(row, now);
		await internalAuditLog.add(access, {
			action: "created",
			object_type: "api-token",
			object_id: row.id,
			meta: shown,
		});
		return { ...shown, token: made.token };
	},

	revokeOwn: async (access, userId, tokenId) => {
		ownOnly(access, userId);
		const row = await apiTokenModel.query().where({ id: tokenId, user_id: userId }).first();
		if (!row) throw new errs.ItemNotFoundError(tokenId);
		await apiTokenModel.query().deleteById(row.id);
		await revoked(access, row);
		return true;
	},

	listAll: async (access) => {
		access.canAdmin();
		const rows = await apiTokenModel
			.query()
			.withGraphFetched("owner")
			.orderBy("created_on", "DESC")
			.orderBy("id", "DESC");
		const now = nowSeconds();
		return rows.map((row) => ({
			...toPublic(row, now),
			owner: row.owner ? { id: row.owner.id, name: row.owner.name, email: row.owner.email } : null,
		}));
	},

	revokeAny: async (access, tokenId) => {
		access.canAdmin();
		const row = await apiTokenModel.query().findById(tokenId);
		if (!row) throw new errs.ItemNotFoundError(tokenId);
		await apiTokenModel.query().deleteById(row.id);
		await revoked(access, row);
		return true;
	},

	/** in the user delete transaction */
	deleteForUser: (trx, userId) => apiTokenModel.query(trx).where("user_id", userId).delete(),

	/**
	 * Writes last_used_on at most once a minute; the first use is audited. A failed write never fails the request,
	 * and nothing is written while a database move holds the writes.
	 *
	 * @param {Object} row  the token row of the request
	 * @param {number} [now]
	 */
	recordUse: async (row, now = nowSeconds()) => {
		if (row.last_used_on !== null && now - row.last_used_on < USE_INTERVAL) return;
		if (maintenance.active()) return;
		try {
			const query = apiTokenModel.query().where("id", row.id);
			if (row.last_used_on === null) query.whereNull("last_used_on");
			else query.where("last_used_on", row.last_used_on);
			const changed = await query.patch({ last_used_on: now });
			if (changed === 1 && row.last_used_on === null) {
				await internalAuditLog.add(null, {
					user_id: row.user_id,
					action: "first-used",
					object_type: "api-token",
					object_id: row.id,
					meta: { name: row.name },
					api_token: row,
				});
			}
		} catch (error) {
			logger.warn(`API token ${row.id}: the last use could not be stored: ${error.message}`);
		}
	},

	/**
	 * Audits every token that has expired and was not audited yet, once each
	 *
	 * @param   {number} [now]
	 * @returns {Promise<number>} how many were audited
	 */
	auditExpired: async (now = nowSeconds()) => {
		const rows = await apiTokenModel
			.query()
			.whereNotNull("expires_on")
			.where("expires_on", "<=", now)
			.where("expiry_audited", false);
		let audited = 0;
		for (const row of rows) {
			const claimed = await apiTokenModel
				.query()
				.where("id", row.id)
				.where("expiry_audited", false)
				.patch({ expiry_audited: true });
			if (claimed !== 1) continue;
			await internalAuditLog.add(null, {
				user_id: row.user_id,
				action: "expired",
				object_type: "api-token",
				object_id: row.id,
				meta: { name: row.name },
				api_token: row,
			});
			audited += 1;
		}
		return audited;
	},
};

/** Audits expired tokens now and every hour (unref: never keeps the process alive) */
const startExpirySweep = () => {
	const sweep = () =>
		internalApiToken
			.auditExpired()
			.catch((error) => logger.warn(`API token expiry sweep failed: ${error.message}`));
	void sweep();
	setInterval(sweep, SWEEP_EVERY).unref();
};

export { nowSeconds, startExpirySweep, toPublic };
export default internalApiToken;
