import assert from "node:assert/strict";
import { it } from "node:test";
import {
	EMAIL_DEFAULTS,
	EMAIL_ENV_KEYS,
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
	});
	assert.deepEqual(NOTIFICATION_ENV_KEYS, { public_url: "PUBLIC_URL", default_language: "MAIL_LANGUAGE" });
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
	assert.deepEqual(notifications.values, { public_url: "https://env.test", default_language: "fr" });
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
