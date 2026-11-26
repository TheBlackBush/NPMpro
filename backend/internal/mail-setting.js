import { lockedByOf } from "../lib/environment-info.js";
import errs from "../lib/error.js";
import {
	alertProblemOf,
	dedupeAlertLists,
	EMAIL_ENV_KEYS,
	isConfigured,
	isSingleAddress,
	mergeEmail,
	mergeNotifications,
	normalizePublicUrl,
	validateEmailPatch,
	validateEmailValues,
	validateNotificationsPatch,
	validateNotificationValues,
} from "../lib/mail/settings-rules.js";
import { checkSmtpTarget } from "../lib/mail/smtp-target.js";
import { MailError } from "../lib/mail/transport.js";
import { getOidcConfig } from "../lib/oidc-config.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { global as logger } from "../logger.js";
import settingModel from "../models/setting.js";
import userModel from "../models/user.js";
import internalAuditLog from "./audit-log.js";
import internalMail from "./mail.js";
import internalPasswordToken from "./password-token.js";

const NAMES = { email: "Email", notifications: "Notifications" };
const TARGET_KEYS = ["host", "port", "security", "username"];
const TEST_ERROR_MAX = 300;
let warnedSecret = false;

const readStored = async (id) => (await settingModel.query().where("id", id).first())?.meta ?? {};

const saveStored = async (id, meta) => {
	if (await settingModel.query().where("id", id).first()) {
		await settingModel.query().where("id", id).patch({ meta });
	} else {
		await settingModel
			.query()
			.insert({ id, name: NAMES[id], description: `${NAMES[id]} settings`, value: id, meta });
	}
};

/**
 * Effective mail settings: stored values, the decrypted password, env overrides
 *
 * @returns {Promise<{values: Object, locked: string[], secretError: boolean}>}  values.password is plain text: callers must
 *          never return it
 */
const getEmailConfig = async () => {
	const { password: sealed, ...stored } = await readStored("email");
	let secretError = false;
	if (sealed && !process.env[EMAIL_ENV_KEYS.password]) {
		try {
			stored.password = defaultSecretBox.decrypt(sealed);
		} catch (err) {
			secretError = true;
			if (!warnedSecret) logger.warn(`The mail password cannot be decrypted: ${err.message}`);
			warnedSecret = true;
		}
	}
	return { ...mergeEmail(stored, process.env), secretError };
};

const getNotificationsConfig = async () => mergeNotifications(await readStored("notifications"), process.env);

/** @returns {Promise<{email: Object, notifications: Object}>}  the merged values, the password in clear (for the sender) */
const mailValues = async () => ({
	email: (await getEmailConfig()).values,
	notifications: (await getNotificationsConfig()).values,
});

/** Plugs the stored settings into the mail sender (startup); without it only the env counts */
const useMailSettings = () => internalMail.useSettings(mailValues);

/** After a restore: the settings are read from the database on every send, only the decrypt warning starts over */
const reloadMailSettings = () => {
	warnedSecret = false;
};

const invalid = (errors) => {
	const [[key, i18n]] = Object.entries(errors);
	return new errs.ValidationError(`The value of ${key} is not valid`, i18n);
};

const dropLocked = (body, locked) => Object.fromEntries(Object.entries(body).filter(([key]) => !locked.includes(key)));

const changedKeys = (patch, current) =>
	Object.keys(patch).filter((key) => JSON.stringify(patch[key]) !== JSON.stringify(current[key]));

// the fields whose effective value the sender would refuse (a restored row, an env value): the UI names them
const configErrorsOf = ({ errors }) => Object.keys(errors);

const emailAnswer = (config) => {
	const { password, ...values } = config.values;
	return {
		...values,
		password_set: Boolean(password) || config.secretError,
		secret_error: config.secretError,
		locked: config.locked,
		locked_by: lockedByOf("email", config.locked),
		configured: isConfigured(config.values),
		config_errors: configErrorsOf(validateEmailValues(config.values)),
	};
};

const notificationsAnswer = (config) => ({
	...config.values,
	locked: config.locked,
	locked_by: lockedByOf("notifications", config.locked),
	config_errors: configErrorsOf(validateNotificationValues(config.values)),
});

// the guard's refusals are public messages of the settings form; a blocked host has a translated key with the host name
// as configured (never a resolved address)
const blockedHost = (host) =>
	new errs.ValidationError(
		"The mail server resolves to an address outbound requests may not reach",
		"error.mail-host-blocked",
		{
			values: { host },
		},
	);
const targetError = (err, host) =>
	err.code === "EBLOCKED" ? blockedHost(host) : new errs.ValidationError(err.message, err.message_i18n);

const resetNeedsPublicUrl = () =>
	new errs.ValidationError("Password reset by mail needs the public URL", "error.reset-needs-public-url");

const audit = (access, action, meta) => internalAuditLog.add(access, { action, object_type: "setting", meta });

// a failed test send as the error the settings form shows: a known cause has its own translated text (the server reply,
// scrubbed, as a detail); only a MailError carries a scrubbed text, anything else gets a generic one
const testFailure = async (err, extra = {}) => {
	if (err instanceof errs.ValidationError) return err;
	if (err?.code === "EBLOCKED") return blockedHost((await getEmailConfig()).values.host);
	if (err instanceof MailError && err.message_i18n) {
		const values = { ...err.message_values, ...extra };
		if (typeof values.error === "string") values.error = values.error.slice(0, TEST_ERROR_MAX);
		return new errs.ValidationError(err.message, err.message_i18n, { values });
	}
	const text = err instanceof MailError ? err.message : "The mail could not be sent";
	return new errs.ValidationError("The test mail could not be sent", "error.mail-test-failed", {
		values: { error: text.slice(0, TEST_ERROR_MAX), ...extra },
	});
};

const internalMailSetting = {
	/**
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	getEmail: async (access) => {
		access.canAdmin();
		return emailAnswer(await getEmailConfig());
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  body  validated against the PUT schema
	 * @returns {Promise<Object>}  the same as getEmail()
	 */
	updateEmail: async (access, body) => {
		access.canAdmin();
		const config = await getEmailConfig();
		const { password, password_clear: clear, ...rest } = body;
		const patch = dropLocked(rest, config.locked);
		const { errors } = validateEmailPatch(patch, config.values);
		if (Object.keys(errors).length > 0) throw invalid(errors);

		const stored = await readStored("email");
		const changed = changedKeys(patch, config.values);
		const next = { ...stored, ...patch };
		const passwordLocked = config.locked.includes("password");
		if (!passwordLocked) {
			if (typeof password === "string" && password !== "") {
				next.password = defaultSecretBox.encrypt(password);
				changed.push("password");
			} else if (clear === true && stored.password) {
				next.password = undefined;
				changed.push("password");
			}
		}

		// switching reset on needs the address its links point at; a stored true kept by a save is not checked again
		if (
			patch.allow_password_reset === true &&
			config.values.allow_password_reset !== true &&
			!normalizePublicUrl((await getNotificationsConfig()).values.public_url)
		)
			throw resetNeedsPublicUrl();

		// the target is resolved and checked at a save that moves it
		if (changed.some((key) => TARGET_KEYS.includes(key))) {
			const target = { ...config.values, ...patch };
			if (target.host) {
				try {
					await checkSmtpTarget(target);
				} catch (err) {
					throw targetError(err, target.host);
				}
			}
		}

		await saveStored("email", JSON.parse(JSON.stringify(next)));
		warnedSecret = false;
		// switching reset off is an emergency stop: the links still out must not come back when it is switched on
		if (patch.allow_password_reset === false && config.values.allow_password_reset === true) {
			await internalPasswordToken.removePurpose("reset");
		}
		await audit(access, "updated", { id: "email", changed });
		return internalMailSetting.getEmail(access);
	},

	/**
	 * Sends a test mail at once (never through the queue) to the caller or to the given address
	 *
	 * @param   {Access}  access
	 * @param   {Object}  [body]  { to? }
	 * @returns {Promise<{sent: true}>}
	 */
	testEmail: async (access, body) => {
		access.canAdmin();
		const user = await userModel.query().findById(access.token.getUserId(0));
		const to = body?.to || user?.email;
		if (!isSingleAddress(to))
			throw new errs.ValidationError("The address is not valid", "settings.email.to.invalid");
		const language = await internalMail.languageOf(user);
		try {
			await internalMail.sendNow({ to, template: "test", language, data: {} });
		} catch (err) {
			throw await testFailure(err);
		}
		await audit(access, "test-sent", { id: "email" });
		return { sent: true };
	},

	/**
	 * Sends the sample alert mail at once to every current alert recipient (each in their language). Every recipient
	 * is tried; when some fail, the answer is the 400 of the first failure with its address (message_values.address),
	 * the number that failed and the number sent: the others got their mail.
	 *
	 * @param   {Access}  access
	 * @returns {Promise<{sent: number}>}
	 */
	testAlerts: async (access) => {
		const { recipients, sent, failed } = await internalMail.sendSample(access);
		if (recipients === 0) throw new errs.ValidationError("Nobody gets alert mails", "error.notify-no-recipients");
		if (sent > 0) await audit(access, "test-sent", { id: "notifications", recipients: sent });
		if (failed.length > 0) {
			const [{ address, error }] = failed;
			throw await testFailure(error, { address, failed: failed.length, sent });
		}
		return { sent };
	},

	/**
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	getNotifications: async (access) => {
		access.canAdmin();
		return notificationsAnswer(await getNotificationsConfig());
	},

	/**
	 * @param   {Access}  access
	 * @param   {Object}  body  validated against the PUT schema
	 * @returns {Promise<Object>}  the same as getNotifications()
	 */
	updateNotifications: async (access, body) => {
		access.canAdmin();
		const config = await getNotificationsConfig();
		const patch = dedupeAlertLists(dropLocked(body, config.locked));
		const problem = alertProblemOf(patch, config.values);
		if (problem) {
			throw new errs.ValidationError(
				"An alert setting is not valid",
				problem.i18n,
				problem.values ? { values: problem.values } : {},
			);
		}
		const { errors } = validateNotificationsPatch(patch, config.values);
		if (Object.keys(errors).length > 0) throw invalid(errors);
		if (patch.public_url) patch.public_url = normalizePublicUrl(patch.public_url);
		await saveStored("notifications", { ...(await readStored("notifications")), ...patch });
		await audit(access, "updated", { id: "notifications", changed: changedKeys(patch, config.values) });
		return internalMailSetting.getNotifications(access);
	},
};

/**
 * Whether a reset by mail is offered: mail configured, a valid public URL, the switch on and password sign-in not turned
 * off by OIDC. Every reset route answers as if no account exists while this is false.
 *
 * @param   {Object}  [oidc]  the result of getOidcConfig() when the caller has it already
 * @returns {Promise<boolean>}
 */
const resetOffered = async (oidc) => {
	// the cheap checks first (this answers the public, polled /api): the switch from the row or the env, without the
	// password (no decrypt), then the public URL, then password sign-in, and the mail server last
	const { password: _sealed, ...stored } = await readStored("email");
	const { values: email } = mergeEmail(stored, process.env);
	if (email.allow_password_reset !== true) return false;
	if (!normalizePublicUrl((await getNotificationsConfig()).values.public_url)) return false;
	const cfg = oidc ?? (await getOidcConfig());
	if (cfg.active && cfg.values.disable_password) return false;
	return isConfigured(email);
};

export { getEmailConfig, getNotificationsConfig, reloadMailSettings, resetOffered, useMailSettings };
export default internalMailSetting;
