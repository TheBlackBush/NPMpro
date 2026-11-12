import { engineOf } from "../lib/database/engine.js";

// a second user with the same identity, by driver code (the message holds the SQL with the provider's values):
// SQLite (better-sqlite3 and sqlite3) constraint codes, MySQL ER_DUP_ENTRY, Postgres 23505
const UNIQUE_CODES = new Set(["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY", "ER_DUP_ENTRY", "23505"]);

// "now" as models/now_helper.js writes it: SQLite local time text, the server's NOW() elsewhere
const nowOf = (knex) => (engineOf(knex) === "sqlite" ? knex.raw("datetime('now','localtime')") : knex.raw("NOW()"));

/**
 * Reads and writes the OIDC identity link of users. Everything is injected; internal/token.js and internal/user.js
 * wire their instances.
 *
 * @param   {Object}    options
 * @param   {Object}    options.knex
 * @param   {Function}  options.audit          (row) => Promise, inserts an audit log row
 * @param   {Function}  options.tryBeginWrite  () => release function, or null during a database move
 */
const createOidcIdentity = ({ knex, audit, tryBeginWrite }) => {
	/**
	 * @param   {{issuer: string, subject: string}}  identity
	 * @returns {Promise<number|null>}  the id of the user linked to the identity
	 */
	const holderOf = async ({ issuer, subject }) => {
		const row = await knex("user")
			.select("id")
			.where({ npmpro_oidc_issuer: issuer, npmpro_oidc_subject: subject })
			.first();
		return row ? Number(row.id) : null;
	};

	/**
	 * @param   {Object}  user      the user row
	 * @param   {{issuer: string, subject: string}}  identity
	 * @param   {"link"|"relink"}  action  linkAction() result
	 * @returns {Promise<"linked"|"skipped"|"mismatch">}  skipped during a database move (the next sign-in links);
	 *          mismatch when another user took the identity first
	 */
	const link = async (user, { issuer, subject }, action) => {
		const release = tryBeginWrite();
		if (!release) return "skipped";
		try {
			try {
				await knex("user")
					.where({ id: user.id })
					.update({
						npmpro_oidc_issuer: issuer,
						npmpro_oidc_subject: subject,
						npmpro_oidc_linked_on: nowOf(knex),
					});
			} catch (err) {
				if (UNIQUE_CODES.has(err?.code)) return "mismatch";
				// knex puts the SQL with the subject into the message: keep only the driver code
				throw Object.assign(new Error("Could not save the OIDC identity link"), { code: err?.code });
			}
			await audit({
				user_id: user.id,
				action: "oidc-linked",
				object_type: "user",
				object_id: user.id,
				meta: {
					name: user.name,
					email: user.email,
					issuer,
					...(action === "relink" ? { relinked: true } : {}),
				},
			});
			return "linked";
		} finally {
			release();
		}
	};

	/**
	 * @param   {number}  userId
	 * @returns {Promise<boolean>}  false when the user was not linked or does not exist
	 */
	const unlink = async (userId) => {
		const changed = await knex("user").where({ id: userId }).whereNotNull("npmpro_oidc_subject").update({
			npmpro_oidc_issuer: null,
			npmpro_oidc_subject: null,
			npmpro_oidc_linked_on: null,
		});
		return changed > 0;
	};

	return { holderOf, link, unlink };
};

export { createOidcIdentity };
