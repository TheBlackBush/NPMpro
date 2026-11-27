import { createHash } from "node:crypto";
import errs from "../lib/error.js";
import { normalizePublicUrl } from "../lib/mail/settings-rules.js";
import { global as logger } from "../logger.js";
import { utcMinute } from "../mail/time.js";
import apiTokenModel from "../models/api_token.js";
import authModel from "../models/auth.js";
import userModel from "../models/user.js";
import internalAuditLog from "./audit-log.js";
import internalMail from "./mail.js";
import { getNotificationsConfig, invitationsOffered, resetOffered } from "./mail-setting.js";
import internalPasswordToken from "./password-token.js";
import internalUser from "./user.js";

// The reset of a password by mail. The request answers before it reads anything about the address (the route sends the
// 202 first and then calls request), so an unknown, a disabled, an OIDC-only and a real user cannot be told apart by the
// answer or its timing. The clear token and the link exist only in the mail: they are never logged, audited or stored.

const ADDRESS_LIMIT = 3;
const ADDRESS_WINDOW_MS = 60 * 60_000;
const ADDRESS_KEYS_MAX = 10_000;

// SHA-256 of the lower-cased address -> the times of its recent requests (in memory, R19: a restart starts over, the
// limit per IP stays)
const recent = new Map();
let pending = Promise.resolve();

const addressKey = (email) => createHash("sha256").update(email.toLowerCase()).digest("hex");

/** @returns {boolean} whether this address may get another mail now; counts the request when it may */
const allowAddress = (email, now = Date.now()) => {
	const key = addressKey(email);
	const times = (recent.get(key) ?? []).filter((time) => now - time < ADDRESS_WINDOW_MS);
	if (times.length >= ADDRESS_LIMIT) {
		recent.set(key, times);
		return false;
	}
	times.push(now);
	recent.delete(key);
	recent.set(key, times);
	// the map keeps the order of the last request: the keys that waited longest go first
	for (const oldest of recent.keys()) {
		if (recent.size <= ADDRESS_KEYS_MAX) break;
		recent.delete(oldest);
	}
	return true;
};

const invalid = () => new errs.ValidationError("This link is invalid or has expired", "error.reset-invalid");

/** The failure of the link mail: a line without the link and an audit row, never the error text of the server */
const mailFailed = async (user, err) => {
	logger.warn(`password reset: the reset mail could not be sent (${err?.code ?? err?.name ?? "error"})`);
	try {
		await internalAuditLog.add(null, {
			user_id: user.id,
			action: "mail-failed",
			object_type: "user",
			object_id: user.id,
			meta: { template: "reset-link" },
		});
	} catch {
		logger.warn("password reset: the failed mail could not be audited");
	}
};

// a token that can be used now: its purpose is on the row, and a reset needs the reset by mail offered; an invitation
// needs invitations offered and a user who is still invited
const usable = async (token) => {
	const found = await internalPasswordToken.find(token);
	if (!found) return null;
	if (found.row.purpose === "reset") return (await resetOffered()) ? found : null;
	if (found.row.purpose === "invite") {
		// the switch is the stop control of the administrator: not offered (off, no mail server, no public URL) is the
		// same answer as any bad token
		if (!(await invitationsOffered())) return null;
		return (await internalUser.isInvited(found.user.id)) ? found : null;
	}
	return null;
};

const auditAccepted = async (user, ip) => {
	try {
		await internalAuditLog.add(null, {
			user_id: user.id,
			action: "invitation-accepted",
			object_type: "user",
			object_id: user.id,
			meta: { ip },
		});
	} catch (err) {
		// the password is set: the answer stays 200
		logger.warn(`invitation: the audit row could not be written (${err?.name ?? "error"})`);
	}
};

const work = async (email, ip) => {
	if (!(await resetOffered())) return;
	// like the sign-in: an enabled user on the address, so a disabled row with the same address is never picked
	const user = await userModel
		.query()
		.where("email", email.toLowerCase())
		.andWhere("is_disabled", 0)
		.orderBy("id")
		.first();
	if (!user || user.is_disabled) return;
	if (!(await authModel.query().where({ user_id: user.id, type: "password" }).first())) return;
	if (!allowAddress(email)) return;
	const base = normalizePublicUrl((await getNotificationsConfig()).values.public_url);
	if (!base) return;
	const token = await internalPasswordToken.create(user.id, "reset", { ip });
	try {
		await internalMail.sendNow({
			to: user.email,
			template: "reset-link",
			language: await internalMail.languageOf(user),
			data: { link: `${base}/reset-password#token=${token}` },
		});
	} catch (err) {
		await mailFailed(user, err);
	}
};

const internalPasswordReset = {
	/**
	 * Starts a reset for an address. Returns at once; the work runs after the answer was sent and never throws.
	 *
	 * @param {Object}  input
	 * @param {String}  input.email  the address as the person typed it
	 * @param {String}  [input.ip]
	 */
	request: ({ email, ip }) => {
		const run = async () => {
			try {
				await work(String(email), ip);
			} catch (err) {
				logger.warn(`password reset: a request could not be handled (${err?.name ?? "error"})`);
			}
		};
		const before = pending;
		pending = new Promise((resolve) => {
			setImmediate(() => resolve(Promise.all([before, run()])));
		});
	},

	/** Test hook: resolves when the background work of the last request is done */
	settled: () => pending,

	/**
	 * What the link is for. A reset token needs a reset by mail to be offered; an invitation token needs invitations
	 * offered and a user who is still invited.
	 *
	 * @param   {String}  token
	 * @returns {Promise<{purpose: String}>}
	 */
	check: async (token) => {
		const found = await usable(token);
		if (!found) throw invalid();
		return { purpose: found.row.purpose };
	},

	/**
	 * Sets the password with a token. A reset token changes the password (kept: two-factor sign-in and API tokens),
	 * audits it and queues the notice. An invitation token sets the first password of a user who is still invited,
	 * audits `invitation-accepted` and sends no notice. A token of one purpose never works as the other.
	 *
	 * @param   {Object}  input
	 * @param   {String}  input.token
	 * @param   {String}  input.password
	 * @param   {String}  [input.ip]
	 * @returns {Promise<true>}
	 */
	confirm: async ({ token, password, ip }) => {
		const found = await usable(token);
		if (!found) throw invalid();
		const purpose = found.row.purpose;
		const user = await internalPasswordToken.consume(
			token,
			async (account, _row, trx) => {
				if (purpose === "invite") {
					// only an account that is still invited: a password or an OIDC link made since ends the invitation
					if (!(await internalUser.isInvited(account.id, trx))) return null;
				} else if (!(await authModel.query(trx).where({ user_id: account.id, type: "password" }).first())) {
					// the account may have lost its password since the link was made: no password is created by a reset
					// link (the link is still spent, the transaction commits its use and nothing else)
					return null;
				}
				await internalUser.setPasswordByReset(account.id, password, trx);
				return account;
			},
			purpose,
		);
		if (!user) throw invalid();
		if (purpose === "invite") {
			await auditAccepted(user, ip);
			return true;
		}
		try {
			await internalAuditLog.add(null, {
				user_id: user.id,
				action: "password-reset",
				object_type: "user",
				object_id: user.id,
				meta: { ip },
			});
		} catch (err) {
			// the password is set: the notice still goes out and the answer stays 200
			logger.warn(`password reset: the audit row could not be written (${err?.name ?? "error"})`);
		}
		try {
			const now = Math.floor(Date.now() / 1000);
			const { count } = await apiTokenModel
				.query()
				.where("user_id", user.id)
				.where((query) => query.whereNull("expires_on").orWhere("expires_on", ">", now))
				.count({ count: "*" })
				.first();
			await internalMail.queueMail({
				to: user.email,
				template: "password-reset",
				language: await internalMail.languageOf(user),
				data: { time: utcMinute(new Date()), ip: ip ?? "", count: Number(count) },
			});
		} catch (err) {
			logger.warn(`password reset: the notice could not be queued (${err?.name ?? "error"})`);
		}
		return true;
	},
};

export { allowAddress };
export default internalPasswordReset;
