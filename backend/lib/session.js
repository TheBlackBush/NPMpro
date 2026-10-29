import crypto from "node:crypto";
import db from "../db.js";
import { maintenance } from "./database/maintenance.js";
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

// logouts during a database move: written by the move into the database that stays (the source is frozen)
const heldRevocations = new Map();
const REVOCATION_CHUNK = 200;

/**
 * @param   {String}  sid
 * @returns {Promise<Boolean>}
 */
const isSessionRevoked = async (sid) => {
	if (typeof sid !== "string") return false;
	if (heldRevocations.has(sid)) return true;
	return Boolean(await db()("session_revocation").where({ sid }).first("id"));
};

/**
 * Revokes the session of a token, and forgets revocations of sessions that have expired anyway. During a database
 * move the revocation is held in memory until the move writes it.
 *
 * @param   {Object}  tokenData  the verified token of the session
 * @returns {Promise}
 */
const revokeSession = async (tokenData) => {
	if (typeof tokenData?.sid !== "string") return;
	const authTime = Number.isInteger(tokenData.auth_time) ? tokenData.auth_time : nowSeconds();
	const expiresAt = authTime + SESSION_MAX_AGE_SECONDS;
	const release = maintenance.tryBeginWrite();
	if (!release) {
		heldRevocations.set(tokenData.sid, expiresAt);
		return;
	}
	try {
		const knex = db();
		await knex("session_revocation").where("expires_at", "<", nowSeconds()).delete();
		await knex("session_revocation")
			.insert({ sid: tokenData.sid, expires_at: expiresAt })
			.onConflict("sid")
			.ignore();
	} finally {
		release();
	}
};

/**
 * The revocations held during a database move, left in memory (still revoked): a copy for the new database before the
 * move commits to it; writeHeldRevocations() writes them for good into the database that stays
 *
 * @returns {Array<{ sid: string, expires_at: number }>}
 */
const peekHeldRevocations = () => [...heldRevocations].map(([sid, expires_at]) => ({ sid, expires_at }));

/**
 * The revocations held during a database move, removed from memory
 *
 * @returns {Array<{ sid: string, expires_at: number }>}
 */
const takeHeldRevocations = () => {
	const rows = [...heldRevocations].map(([sid, expires_at]) => ({ sid, expires_at }));
	heldRevocations.clear();
	return rows;
};

/**
 * Writes the revocations held during a database move into the database that stays: the new one before the process
 * exits, or the old one after a failed move (end the maintenance first, so later logouts are written directly). Loops
 * until none is left, so the caller can exit right after it returns without a logout in between being lost. Rows that
 * could not be written are held again (they still count as revoked) and the error is thrown.
 *
 * @param   {Function}  knex  the database that stays
 * @returns {Promise<number>}  the number of rows written
 */
const writeHeldRevocations = async (knex) => {
	let written = 0;
	while (heldRevocations.size > 0) {
		const rows = takeHeldRevocations();
		try {
			// chunks stay below the SQLite variable limit
			for (let i = 0; i < rows.length; i += REVOCATION_CHUNK) {
				await knex("session_revocation")
					.insert(rows.slice(i, i + REVOCATION_CHUNK))
					.onConflict("sid")
					.ignore();
			}
		} catch (error) {
			for (const { sid, expires_at } of rows) if (!heldRevocations.has(sid)) heldRevocations.set(sid, expires_at);
			throw error;
		}
		written += rows.length;
	}
	return written;
};

export {
	continueSession,
	isSessionRevoked,
	newSession,
	peekHeldRevocations,
	revokeSession,
	SESSION_MAX_AGE_SECONDS,
	takeHeldRevocations,
	writeHeldRevocations,
};
