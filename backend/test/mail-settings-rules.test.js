import assert from "node:assert/strict";
import { it } from "node:test";
import {
	alertProblemOf,
	EMAIL_DEFAULTS,
	EMAIL_ENV_KEYS,
	ehloNameOf,
	isConfigured,
	MAIL_LANGUAGES,
	mergeEmail,
	mergeNotifications,
	NOTIFICATION_DEFAULTS,
	NOTIFICATION_ENV_KEYS,
	normalizePublicUrl,
	publicHostOf,
	validateEmailPatch,
	validateEmailValues,
	validateNotificationsPatch,
	validateNotificationValues,
} from "../lib/mail/settings-rules.js";

const okEmail = (patch, current) => validateEmailPatch(patch, current).errors;

it("names every env key and the 13 languages", () => {
	assert.deepEqual(EMAIL_ENV_KEYS, {
		host: "SMTP_HOST",
		port: "SMTP_PORT",
		security: "SMTP_SECURITY",
		verify_tls: "SMTP_VERIFY_TLS",
		username: "SMTP_USERNAME",
		password: "SMTP_PASSWORD",
		from_address: "SMTP_FROM",
		from_name: "SMTP_FROM_NAME",
		reply_to: "SMTP_REPLY_TO",
		allow_password_reset: "PASSWORD_RESET",
	});
	assert.deepEqual(NOTIFICATION_ENV_KEYS, {
		public_url: "PUBLIC_URL",
		default_language: "MAIL_LANGUAGE",
		alerts_addresses: "ALERT_ADDRESSES",
	});
	assert.equal(MAIL_LANGUAGES.length, 13);
});

it("defaults apply when nothing is stored or set", () => {
	assert.deepEqual(mergeEmail({}, {}), { values: EMAIL_DEFAULTS, locked: [] });
	assert.deepEqual(mergeNotifications({}, {}), { values: NOTIFICATION_DEFAULTS, locked: [] });
	assert.equal(EMAIL_DEFAULTS.port, 587);
	assert.equal(EMAIL_DEFAULTS.security, "starttls");
	assert.equal(EMAIL_DEFAULTS.verify_tls, true);
	assert.equal(NOTIFICATION_DEFAULTS.default_language, "en");
});

it("stored values apply, null and undefined fall back to the default", () => {
	const { values, locked } = mergeEmail({ host: "mail.example.com", port: null, security: "tls" }, {});
	assert.equal(values.host, "mail.example.com");
	assert.equal(values.port, 587);
	assert.equal(values.security, "tls");
	assert.deepEqual(locked, []);
});

it("env wins per key and locks only the keys it sets, an empty variable does not lock", () => {
	const env = {
		SMTP_HOST: "smtp.env.test",
		SMTP_PORT: "465",
		SMTP_VERIFY_TLS: "false",
		SMTP_PASSWORD: "pw",
		SMTP_FROM: "",
	};
	const { values, locked } = mergeEmail({ host: "stored.test", from_address: "a@b.c", port: 25 }, env);
	assert.equal(values.host, "smtp.env.test");
	assert.equal(values.port, 465);
	assert.equal(values.verify_tls, false);
	assert.equal(values.password, "pw");
	assert.equal(values.from_address, "a@b.c");
	assert.deepEqual(locked, ["host", "port", "verify_tls", "password"]);
	const notifications = mergeNotifications(
		{ public_url: "https://stored.test", default_language: "de" },
		{ PUBLIC_URL: "https://env.test", MAIL_LANGUAGE: "fr" },
	);
	assert.deepEqual(notifications.values, {
		...NOTIFICATION_DEFAULTS,
		public_url: "https://env.test",
		default_language: "fr",
	});
	assert.deepEqual(notifications.locked, ["public_url", "default_language"]);
});

it("mail is configured with a host and a sender", () => {
	assert.equal(isConfigured(mergeEmail({}, {}).values), false);
	assert.equal(isConfigured({ host: "h", from_address: "" }), false);
	assert.equal(isConfigured({ host: "", from_address: "a@b.c" }), false);
	assert.equal(isConfigured(mergeEmail({}, { SMTP_HOST: "127.0.0.1", SMTP_FROM: "flow@example.com" }).values), true);
	assert.equal(isConfigured(undefined), false);
});

it("accepts one plain address and refuses lists, names, CR, LF, NUL and long values", () => {
	assert.deepEqual(okEmail({ from_address: "a@b.c" }), {});
	assert.deepEqual(okEmail({ from_address: "", reply_to: "" }), {});
	for (const bad of [
		"a@b.c, d@e.f",
		"a@b.c; d@e.f",
		"a@b.c\r\nBcc: x@y.z",
		"a@b.c\nd@e.f",
		"a@b.c\r",
		"a@b.c\0",
		"a@b.c\x85",
		"a\\b@c.d",
		"=?utf-8?B?QQ==?=@b.c",
		"a@b.c\u2028",
		"é@b.c",
		'"x" <a@b.c>',
		"<a@b.c>",
		"not an address",
		"a@b@c.d",
		`${"a".repeat(251)}@b.c`,
		42,
		null,
	]) {
		assert.deepEqual(
			okEmail({ from_address: bad }),
			{ from_address: "settings.email.from-address.invalid" },
			String(bad),
		);
		assert.deepEqual(okEmail({ reply_to: bad }), { reply_to: "settings.email.reply-to.invalid" }, String(bad));
	}
	assert.deepEqual(okEmail({ from_address: `${"a".repeat(248)}@b.cde` }), {});
	assert.equal(Object.keys(okEmail({ from_address: `${"a".repeat(249)}@b.cde` })).length, 1);
});

it("checks port, security, verify_tls, from_name and username", () => {
	assert.deepEqual(okEmail({ port: 1 }), {});
	assert.deepEqual(okEmail({ port: 65535 }), {});
	for (const port of [0, 65536, 1.5, "25", null, Number.NaN]) {
		assert.deepEqual(okEmail({ port }), { port: "settings.email.port.invalid" }, String(port));
	}
	for (const security of ["starttls", "tls", "none"]) assert.deepEqual(okEmail({ security }), {});
	assert.deepEqual(okEmail({ security: "ssl" }), { security: "settings.email.security.invalid" });
	assert.deepEqual(okEmail({ verify_tls: false }), {});
	assert.deepEqual(okEmail({ verify_tls: "false" }), { verify_tls: "settings.email.verify-tls.invalid" });
	assert.deepEqual(okEmail({ from_name: "NPMpro Alerts" }), {});
	assert.deepEqual(okEmail({ from_name: "a".repeat(100) }), {});
	for (const from_name of ['say "hi"', "a\nb", "a\rb", "a".repeat(101)]) {
		assert.deepEqual(okEmail({ from_name }), { from_name: "settings.email.from-name.invalid" }, from_name);
	}
	assert.deepEqual(okEmail({ username: "user@example.com" }), {});
	assert.deepEqual(okEmail({ username: "a\r\nb" }), { username: "settings.email.username.invalid" });
	assert.deepEqual(okEmail({ username: "a".repeat(255) }), { username: "settings.email.username.invalid" });
});

it("checks only the keys of the patch and reports every bad one", () => {
	assert.deepEqual(okEmail({ host: "mail.test", password: "x" }), {});
	assert.deepEqual(
		Object.keys(okEmail({ port: 0, security: "x", from_address: "bad" })).sort((a, b) => a.localeCompare(b)),
		["from_address", "port", "security"],
	);
});

it("a stored invalid value passes a save that keeps it and fails a save that changes it", () => {
	const current = { from_address: "Team <a@b.c>", port: 0, from_name: 'a"b' };
	assert.deepEqual(okEmail({ from_address: "Team <a@b.c>", port: 0, from_name: 'a"b' }, current), {});
	assert.deepEqual(okEmail({ from_address: "Team <a@b.c>x" }, current), {
		from_address: "settings.email.from-address.invalid",
	});
	assert.deepEqual(okEmail({ port: 1 }, current), {});
});

it("stores the public url without the trailing slash and refuses everything but a bare https origin", () => {
	assert.equal(normalizePublicUrl("https://npm.example.com/"), "https://npm.example.com");
	assert.equal(normalizePublicUrl("https://npm.example.com"), "https://npm.example.com");
	assert.equal(normalizePublicUrl("https://npm.example.com:8443/"), "https://npm.example.com:8443");
	assert.equal(normalizePublicUrl("HTTPS://X.com/"), "https://x.com");
	assert.equal(normalizePublicUrl("https://x.com:443"), "https://x.com");
	for (const bad of [
		"http://npm.example.com",
		"https://x/y",
		"https://x//",
		"https://u:p@x",
		"https://u@x",
		"https://x?a",
		"https://x/?a=1",
		"https://x#f",
		"https://x/#f",
		"https://x y",
		"https://x.com/\0",
		"https://x.com/\x01",
		"https://x.com/\x1b",
		"https://x.com\x85",
		"https:/x.com",
		"https:x.com",
		" https://x.com",
		"https://x.com ",
		"https://x\\y",
		"ftp://x",
		"npm.example.com",
		"https://",
		7,
	]) {
		assert.equal(normalizePublicUrl(bad), null, String(bad));
	}
	assert.deepEqual(validateNotificationsPatch({ public_url: "https://npm.example.com/" }).errors, {});
	assert.deepEqual(validateNotificationsPatch({ public_url: "" }).errors, {});
	assert.deepEqual(validateNotificationsPatch({ public_url: "http://x" }).errors, {
		public_url: "settings.notifications.public-url.invalid",
	});
});

it("checks the default language and keeps a stored value that is kept", () => {
	for (const code of MAIL_LANGUAGES)
		assert.deepEqual(validateNotificationsPatch({ default_language: code }).errors, {});
	assert.deepEqual(validateNotificationsPatch({ default_language: "xx" }).errors, {
		default_language: "settings.notifications.default-language.invalid",
	});
	assert.deepEqual(
		validateNotificationsPatch({ public_url: "http://old.test" }, { public_url: "http://old.test" }).errors,
		{},
	);
});

it("works out the host of the public url", () => {
	assert.equal(publicHostOf({ public_url: "https://npm.example.com" }), "npm.example.com");
	assert.equal(publicHostOf({ public_url: "https://npm.example.com:8443" }), "npm.example.com:8443");
	assert.equal(publicHostOf({ public_url: "" }), null);
	assert.equal(publicHostOf({ public_url: "not a url" }), null);
	assert.equal(publicHostOf(undefined), null);
	// only a valid public URL counts
	assert.equal(publicHostOf({ public_url: "http://npm.example.com" }), null);
});

it("takes the EHLO name from the public URL without its port, else a host name with a dot, else none", () => {
	const at = (public_url, host = "511cefe860e1") => ehloNameOf({ public_url }, host);
	assert.equal(at("https://npm.example.com:81"), "npm.example.com");
	assert.equal(at("https://npm.example.com"), "npm.example.com");
	assert.equal(at("https://10.0.0.5:81"), "[10.0.0.5]");
	assert.equal(at("https://[2001:db8::5]:81"), "[IPv6:2001:db8::5]");
	assert.equal(at(""), undefined);
	assert.equal(at("", "proxy.lan.example"), "proxy.lan.example");
	assert.equal(at("http://npm.example.com", "box"), undefined);
	assert.equal(ehloNameOf(undefined, ""), undefined);
});

it("merges PUBLIC_URL as the origin and keeps an invalid one as it is, so the check names it", () => {
	const merged = mergeNotifications({}, { PUBLIC_URL: "https://NPM.Example.com/" });
	assert.equal(merged.values.public_url, "https://npm.example.com");
	assert.deepEqual(merged.locked, ["public_url"]);
	assert.equal(mergeNotifications({ public_url: "https://A.test" }, {}).values.public_url, "https://a.test");
	assert.equal(mergeNotifications({}, { PUBLIC_URL: "http://x.test" }).values.public_url, "http://x.test");
});

it("checks the merged values: an env sender with CR and LF is an error, a kept legacy stored value too", () => {
	const good = mergeEmail({ host: "h", from_address: "a@b.c" }, {});
	assert.deepEqual(validateEmailValues(good.values), { errors: {} });
	assert.deepEqual(validateEmailValues(mergeEmail({}, {}).values), { errors: {} });
	const injected = mergeEmail({ from_address: "a@b.c" }, { SMTP_FROM: "a@b.c\r\nBcc: x@y.z", SMTP_FROM_NAME: 'x"y' });
	assert.deepEqual(injected.locked, ["from_address", "from_name"]);
	assert.deepEqual(validateEmailValues(injected.values).errors, {
		from_address: "settings.email.from-address.invalid",
		from_name: "settings.email.from-name.invalid",
	});
	// a legacy stored value passes a save that keeps it, but never the check of the merged values
	const legacy = { from_address: "a@b.c, d@e.f" };
	assert.deepEqual(validateEmailPatch({ from_address: legacy.from_address }, legacy), { errors: {} });
	assert.deepEqual(validateEmailValues(mergeEmail(legacy, {}).values).errors, {
		from_address: "settings.email.from-address.invalid",
	});
	const url = mergeNotifications({}, { PUBLIC_URL: "https://x/y?a", MAIL_LANGUAGE: "xx" });
	assert.deepEqual(validateNotificationValues(url.values).errors, {
		public_url: "settings.notifications.public-url.invalid",
		default_language: "settings.notifications.default-language.invalid",
	});
	assert.deepEqual(validateNotificationValues(mergeNotifications({}, {}).values), { errors: {} });
});

it("allow_password_reset is off by default, on only for the word true, and must be a boolean", () => {
	assert.equal(mergeEmail({}, {}).values.allow_password_reset, false);
	assert.equal(mergeEmail({ allow_password_reset: true }, {}).values.allow_password_reset, true);
	for (const raw of ["1", "yes", "TRUE", "false"]) {
		assert.equal(
			mergeEmail({ allow_password_reset: true }, { PASSWORD_RESET: raw }).values.allow_password_reset,
			false,
			raw,
		);
	}
	const on = mergeEmail({}, { PASSWORD_RESET: "true" });
	assert.equal(on.values.allow_password_reset, true);
	assert.deepEqual(on.locked, ["allow_password_reset"]);
	assert.deepEqual(okEmail({ allow_password_reset: "true" }), {
		allow_password_reset: "settings.email.allow-password-reset.invalid",
	});
	assert.deepEqual(okEmail({ allow_password_reset: false }), {});
});

it("the alert settings: defaults, the env list, one problem with its placeholders, a kept value passes", () => {
	const { values } = mergeNotifications({}, {});
	assert.equal(values.alerts_admins, true);
	assert.deepEqual(values.alerts_addresses, []);
	assert.equal(values.reminder_hours, 24);
	assert.ok(values.alerts_events.includes("backup.failed"));
	assert.ok(!values.alerts_events.includes("host.created"));
	const listed = mergeNotifications({}, { ALERT_ADDRESSES: "a@b.c, d@e.f,," });
	assert.deepEqual(listed.values.alerts_addresses, ["a@b.c", "d@e.f"]);
	assert.deepEqual(listed.locked, ["alerts_addresses"]);
	assert.deepEqual(alertProblemOf({ alerts_events: ["host.created"] }, values), {
		i18n: "error.notify-event-not-for-mail",
		values: { event: "host.created" },
	});
	assert.deepEqual(alertProblemOf({ alerts_addresses: ["a@b.c", "x"] }, values), {
		i18n: "settings.notifications.alerts-addresses.invalid",
		values: { index: 1, address: "x" },
	});
	// a value that is not text is named by its index only
	assert.deepEqual(alertProblemOf({ alerts_addresses: ["a@b.c", 5] }, values), {
		i18n: "settings.notifications.alerts-addresses.invalid",
		values: { index: 1 },
	});
	assert.equal(
		alertProblemOf({ alerts_events: Array.from({ length: 10 }, () => "backup.failed") }, values).i18n,
		"settings.notifications.alerts-events.invalid",
	);
	assert.equal(
		alertProblemOf({ alerts_events: ["backup.failed.resolved"] }, values).i18n,
		"error.notify-event-not-for-mail",
	);
	assert.equal(alertProblemOf({ reminder_hours: 169 }, values).i18n, "settings.notifications.reminder-hours.invalid");
	assert.equal(alertProblemOf({ alerts_events: ["host.created"] }, { alerts_events: ["host.created"] }), null);
	assert.equal(alertProblemOf({ alerts_events: values.alerts_events, reminder_hours: 0 }, values), null);
	assert.deepEqual(validateNotificationValues({ ...values, alerts_events: ["*"] }).errors, {
		alerts_events: "settings.notifications.alerts-events.invalid",
	});
});
