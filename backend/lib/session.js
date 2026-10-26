import crypto from "node:crypto";
import db from "../db.js";
import errs from "./error.js";

/**
 * A web UI session: every token of one sign-in carries the same sid and the sign-in time (auth_time), refreshes keep
 * both. A session can be refreshed for SESSION_MAX_AGE_SECONDS, then the user signs in again. Logout revokes the sid,
 * so a copy of any token of that session stops working; the revocation is stored in the database (it survives a
 * restart) until the session could not be refreshed anyway.
 */

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * @returns {{sid: String, auth_time: Number}}  the session claims of a new sign-in
 */
const newSession = () => ({ sid: crypto.randomBytes(16).toString("base64url"), auth_time: nowSeconds() });

/**
 * The session claims for a refreshed token. A token from before sessions existed starts a session now.
 *
 * @param   {Object}  tokenData  the verified token being refreshed
 * @param   {Number}  [now]
 * @returns {{sid: String, auth_time: Number}}
 */
const continueSession = (tokenData, now = nowSeconds()) => {
	if (typeof tokenData?.sid !== "string" || !Number.isInteger(tokenData?.auth_time)) return newSession();
	if (now - tokenData.auth_time > SESSION_MAX_AGE_SECONDS) {
		throw new errs.PermissionError("The session is older than 30 days, please sign in again");
	}
	return { sid: tokenData.sid, auth_time: tokenData.auth_time };
};

/**
 * @param   {String}  sid
 * @returns {Promise<Boolean>}
 */
const isSessionRevoked = async (sid) => {
	if (typeof sid !== "string") return false;
	return Boolean(await db()("session_revocation").where({ sid }).first("id"));
};

/**
 * Revokes the session of a token, and forgets revocations of sessions that have expired anyway.
 *
 * @param   {Object}  tokenData  the verified token of the session
 * @returns {Promise}
 */
const revokeSession = async (tokenData) => {
	if (typeof tokenData?.sid !== "string") return;
	const authTime = Number.isInteger(tokenData.auth_time) ? tokenData.auth_time : nowSeconds();
	const knex = db();
	await knex("session_revocation").where("expires_at", "<", nowSeconds()).delete();
	await knex("session_revocation")
		.insert({ sid: tokenData.sid, expires_at: authTime + SESSION_MAX_AGE_SECONDS })
		.onConflict("sid")
		.ignore();
};

export { continueSession, isSessionRevoked, newSession, revokeSession, SESSION_MAX_AGE_SECONDS };
