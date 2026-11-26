import { createHash, randomBytes } from "node:crypto";
import db from "../db.js";
import { dbTimeOf, msOfDbTime } from "../lib/notify/db-time.js";
import passwordTokenModel from "../models/password_token.js";
import userModel from "../models/user.js";

// One-time tokens that let a user set a password without signing in (reset now, invitations in PR 5). The clear token is
// 32 random bytes in base64url, handed out once; the table keeps only its SHA-256 (the token has full entropy, so no
// slow hash), and a token is found by a lookup on that hash, so nothing compares the clear token byte by byte.

const PURPOSES = new Set(["reset", "invite"]);
// 32 bytes in base64url: 43 characters without padding
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/u;
const DEFAULT_LIFETIME_MS = { reset: 30 * 60_000 };

const hashOf = (token) => createHash("sha256").update(token).digest("hex");

// null for anything that cannot be a token of ours, before the database is asked
const hashOfValid = (token) => (typeof token === "string" && TOKEN_SHAPE.test(token) ? hashOf(token) : null);

const lookup = async (trx, token, purpose) => {
	const hash = hashOfValid(token);
	if (!hash) return null;
	const query = passwordTokenModel.query(trx).where({ token_hash: hash }).whereNull("used_on");
	if (purpose) query.where({ purpose });
	const row = await query.first();
	if (!row || msOfDbTime(row.expires_on) <= Date.now()) return null;
	const user = await userModel.query(trx).findById(row.user_id);
	if (!user || user.is_disabled) return null;
	return { row, user };
};

const internalPasswordToken = {
	/**
	 * Makes a token and removes the older tokens of that user and purpose. The clear token is returned once and is
	 * never stored, logged or audited.
	 *
	 * @param   {Number}  userId
	 * @param   {String}  purpose  reset or invite
	 * @param   {Object}  [options]
	 * @param   {String}  [options.ip]  the requesting address, kept for the administrator
	 * @param   {Number}  [options.lifetimeMs]  how long the token lives; 30 minutes for a reset
	 * @returns {Promise<String>}
	 */
	create: async (userId, purpose, { ip, lifetimeMs } = {}) => {
		if (!PURPOSES.has(purpose)) throw new Error(`${purpose} is not a password token purpose`);
		const lifetime = lifetimeMs ?? DEFAULT_LIFETIME_MS[purpose];
		if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error("A password token needs a lifetime");
		const token = randomBytes(32).toString("base64url");
		const toDbTime = dbTimeOf(db());
		const now = Date.now();
		await passwordTokenModel.transaction(async (trx) => {
			await passwordTokenModel.query(trx).where({ user_id: userId, purpose }).delete();
			await passwordTokenModel.query(trx).insert({
				user_id: userId,
				purpose,
				token_hash: hashOf(token),
				created_on: toDbTime(now),
				expires_on: toDbTime(now + lifetime),
				requested_ip: ip ? String(ip).slice(0, 45) : null,
			});
		});
		return token;
	},

	/**
	 * @param   {String}  token
	 * @param   {String}  [purpose]  only a token of this purpose
	 * @returns {Promise<{row: Object, user: Object}|null>}  null when the token is unknown, used, expired, or its user
	 *                                                       is gone or disabled
	 */
	find: (token, purpose) => lookup(db(), token, purpose),

	/**
	 * In one transaction: finds the token, marks it used and runs fn(user, row); a failing fn rolls the use back. A
	 * second consume of the same token finds nothing.
	 *
	 * @param   {String}    token
	 * @param   {Function}  fn  (user, row, trx) => result
	 * @param   {String}    [purpose]
	 * @returns {Promise<*>}  the result of fn, or null when there is no usable token
	 */
	consume: (token, fn, purpose) =>
		passwordTokenModel.transaction(async (trx) => {
			const found = await lookup(trx, token, purpose);
			if (!found) return null;
			// the conditional update settles two requests that found the same token: only one changes a row
			const used = await passwordTokenModel
				.query(trx)
				.where({ id: found.row.id })
				.whereNull("used_on")
				.patch({ used_on: dbTimeOf(db())(Date.now()) });
			if (used !== 1) return null;
			return fn(found.user, found.row, trx);
		}),

	/** In the transaction of a password change or a user delete: the tokens of the user all go */
	removeForUser: (trx, userId) => passwordTokenModel.query(trx).where({ user_id: userId }).delete(),

	/** The hourly sweep: used and expired tokens go */
	sweep: () =>
		passwordTokenModel
			.query()
			.whereNotNull("used_on")
			.orWhere("expires_on", "<=", dbTimeOf(db())(Date.now()))
			.delete(),
};

export default internalPasswordToken;
