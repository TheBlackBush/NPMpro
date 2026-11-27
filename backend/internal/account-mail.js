import { global as logger } from "../logger.js";
import { utcMinute } from "../mail/time.js";
import internalMail from "./mail.js";
import { accountNoticesOn } from "./mail-setting.js";

// The account notices: a password, the address, two-factor sign-in or the backup codes of an account changed. They go
// through the queue (a server that is down gets the retries) and only when the switch is on and mail is configured.
// A notice never holds a password, a code, a token or the name of an administrator, and a failure to queue one never
// fails the change that caused it. The reset by mail has its own notice (internal/password-reset.js, always sent).

const send = async ({ what, user, address, template, data }) => {
	try {
		if (!(await accountNoticesOn())) return;
		await internalMail.queueMail({
			to: address,
			template,
			language: await internalMail.languageOf(user),
			data: { time: utcMinute(new Date()), ...data },
		});
	} catch (err) {
		logger.warn(`account mail: the ${what} notice could not be queued (${err?.name ?? "error"})`);
	}
};

const internalAccountMail = {
	/** "Password changed" to the user; byAdmin names "an administrator" */
	noticePasswordChanged: (user, byAdmin) =>
		send({
			what: "password changed",
			user,
			address: user.email,
			template: "password-changed",
			data: { byAdmin: Boolean(byAdmin) },
		}),

	/**
	 * "Address changed" to the old address (it never names the new one) and "this address is now used" to the new one,
	 * each to its own address only, in the language of the user
	 */
	noticeAddressChanged: async (user, oldEmail) => {
		const what = "address changed";
		const template = "address-changed";
		await send({ what, user, address: oldEmail, template, data: { which: "old" } });
		await send({ what, user, address: user.email, template, data: { which: "new" } });
	},

	/** "Two-factor sign-in turned off" to the user */
	noticeMfaOff: (user, byAdmin) =>
		send({ what: "MFA off", user, address: user.email, template: "mfa-off", data: { byAdmin: Boolean(byAdmin) } }),

	/** "New backup codes" to the user (the codes are never in the mail) */
	noticeBackupCodes: (user, byAdmin) =>
		send({
			what: "backup codes",
			user,
			address: user.email,
			template: "backup-codes",
			data: { byAdmin: Boolean(byAdmin) },
		}),
};

export default internalAccountMail;
