import assert from "node:assert/strict";
import { it } from "node:test";
import {
	browserPublicUrl,
	emailPayload,
	emailValidate,
	emailValues,
	isSingleAddress,
	MAIL_LANGUAGES,
	normalizePublicUrl,
	notificationPayload,
	notificationsValidate,
	notificationValues,
	publicUrlValidate,
	sendsPlainLogin,
	testMailValidate,
} from "./NotificationForms.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations({ formatMessage: ({ id }, values) => `${id}${values ? JSON.stringify(values) : ""}` });

const stored = {
	host: "smtp.example.com",
	port: 587,
	security: "starttls",
	verifyTls: true,
	username: "user",
	fromName: "NPMpro",
	fromAddress: "npmpro@example.com",
	replyTo: "",
	passwordSet: true,
	locked: [],
};

it("accepts one plain address and refuses what the backend refuses", () => {
	assert.equal(isSingleAddress("a@b.example"), true);
	for (const bad of [
		"",
		"a@b.example\r\nBcc: x@y.example",
		"a@b.example\n",
		"a\0@b.example",
		"Name <a@b.example>",
		"a@b.example, c@d.example",
		"a\\b@c.example",
		"=?utf-8?q?x?=@b.example",
		"a b@c.example",
		"ä@b.example",
		`${"a".repeat(250)}@b.example`,
		"no-at-sign",
		undefined,
	]) {
		assert.equal(isSingleAddress(bad), false, JSON.stringify(bad));
	}
});

it("reduces the public URL to an https origin and refuses the rest", () => {
	assert.equal(normalizePublicUrl("https://NPM.example.com"), "https://npm.example.com");
	assert.equal(normalizePublicUrl("https://npm.example.com:81/"), "https://npm.example.com:81");
	for (const bad of [
		"http://npm.example.com",
		"HTTPS//x",
		"https://npm.example.com/path",
		"https://npm.example.com/?a=1",
		"https://npm.example.com/#a",
		"https://user@npm.example.com",
		"https://npm.example.com\\@evil.example",
		"https://npm example.com",
		"https://ä.example",
		"",
		null,
	]) {
		assert.equal(normalizePublicUrl(bad), null, JSON.stringify(bad));
	}
	assert.equal(publicUrlValidate(""), null);
	assert.equal(publicUrlValidate("  "), null);
	assert.equal(publicUrlValidate(" https://npm.example.com "), null);
	assert.equal(publicUrlValidate("http://x"), "settings.notifications.public-url.invalid");
});

it("takes the browser's address only over https", () => {
	assert.equal(browserPublicUrl(new URL("https://x:81/settings")), "https://x:81");
	assert.equal(browserPublicUrl(new URL("https://x/")), "https://x");
	assert.equal(browserPublicUrl(new URL("http://x")), null);
	assert.equal(browserPublicUrl(undefined), null);
});

it("checks the mail server fields", () => {
	assert.deepEqual(emailValidate(emailValues(stored)), {});
	assert.deepEqual(emailValidate(emailValues({})), {});
	const errors = emailValidate({
		...emailValues(stored),
		port: "0",
		fromName: 'A "quoted" name',
		username: "a\nb",
		fromAddress: "x",
		replyTo: "a@b.example\r\nBcc: c@d.example",
		security: "ssl",
		host: "h".repeat(254),
	});
	assert.deepEqual(
		Object.keys(errors).sort((a, b) => a.localeCompare(b)),
		["fromAddress", "fromName", "host", "port", "replyTo", "security", "username"],
	);
	assert.equal(errors.fromAddress.id, "settings.email.from-address.invalid");
	assert.equal(errors.replyTo.id, "settings.email.reply-to.invalid");
	assert.deepEqual(errors.host, { id: "error.max-character-length", values: { max: 253 } });
	for (const port of ["", "abc", "65536", "5.5", "-1"]) {
		assert.ok(emailValidate({ ...emailValues(stored), port }).port, port);
	}
	for (const port of ["1", "587", "65535"]) {
		assert.equal(emailValidate({ ...emailValues(stored), port }).port, undefined, port);
	}
});

it("leaves the fields set by the environment out of the checks", () => {
	const values = {
		...emailValues(stored),
		fromAddress: "x",
		port: "0",
		publicUrl: "http://x",
		defaultLanguage: "xx",
	};
	const none = () => false;
	assert.deepEqual(
		Object.keys(notificationsValidate(rules, { isEmailLocked: none, isNotificationsLocked: none })(values)).sort(
			(a, b) => a.localeCompare(b),
		),
		["defaultLanguage", "fromAddress", "port", "publicUrl"],
	);
	const all = () => true;
	assert.deepEqual(notificationsValidate(rules, { isEmailLocked: all, isNotificationsLocked: all })(values), {});
	assert.equal(
		notificationsValidate(rules, { isEmailLocked: none, isNotificationsLocked: none })(values).port,
		"settings.email.port.invalid",
	);
});

it("sends only what changed and never a locked key or an empty password", () => {
	const values = emailValues(stored);
	assert.equal(emailPayload(values, stored), null);
	assert.deepEqual(emailPayload({ ...values, port: " 465 ", security: "tls", fromName: " Me " }, stored), {
		port: 465,
		security: "tls",
		fromName: "Me",
	});
	assert.deepEqual(emailPayload({ ...values, password: "secret" }, stored), { password: "secret" });
	assert.deepEqual(emailPayload({ ...values, clearPassword: true, password: "x" }, stored), { passwordClear: true });
	const locked = { ...stored, locked: ["host", "password", "from_address"] };
	assert.deepEqual(
		emailPayload(
			{ ...values, host: "other", password: "x", clearPassword: true, fromAddress: "a@b.example" },
			locked,
		),
		null,
	);
});

it("sends the changed notification settings only", () => {
	const data = { publicUrl: "https://npm.example.com", defaultLanguage: "de", locked: [] };
	const values = notificationValues(data);
	assert.deepEqual(values, { publicUrl: "https://npm.example.com", defaultLanguage: "de" });
	assert.equal(notificationPayload(values, data), null);
	assert.deepEqual(notificationPayload({ publicUrl: " ", defaultLanguage: "fr" }, data), {
		publicUrl: "",
		defaultLanguage: "fr",
	});
	assert.equal(
		notificationPayload({ publicUrl: "x", defaultLanguage: "de" }, { ...data, locked: ["public_url"] }),
		null,
	);
	assert.deepEqual(notificationValues({}), { publicUrl: "", defaultLanguage: "en" });
	assert.equal(MAIL_LANGUAGES.length, 13);
});

it("warns when a login would go out unencrypted", () => {
	assert.equal(sendsPlainLogin({ security: "none", username: "u" }), true);
	assert.equal(sendsPlainLogin({ security: "none", username: " " }), false);
	assert.equal(sendsPlainLogin({ security: "tls", username: "u" }), false);
});

it("checks the address of a test mail", () => {
	assert.equal(testMailValidate("a@b.example"), null);
	assert.equal(testMailValidate(" a@b.example "), null);
	assert.equal(testMailValidate(""), "settings.email.to.invalid");
	assert.equal(testMailValidate("a@b.example, c@d.example"), "settings.email.to.invalid");
});

it("caps the public URL at 253 characters like the backend", () => {
	const long = `https://${"a".repeat(250)}.example`;
	assert.equal(publicUrlValidate(long), "error.max-character-length");
	const message = notificationsValidate(rules, { isEmailLocked: () => false, isNotificationsLocked: () => false })({
		...emailValues(stored),
		publicUrl: long,
		defaultLanguage: "en",
	});
	assert.equal(message.publicUrl, 'error.max-character-length{"max":253}');
});

it("does not check a value kept as stored, so a legacy value never blocks another field", () => {
	const legacy = {
		...stored,
		fromName: 'Old "name"',
		fromAddress: "legacy",
		publicUrl: "http://legacy",
		defaultLanguage: "xx",
	};
	const savedEmail = emailValues(legacy);
	const savedNotifications = notificationValues(legacy);
	const none = () => false;
	const validate = notificationsValidate(
		rules,
		{ isEmailLocked: none, isNotificationsLocked: none },
		{ savedEmail, savedNotifications },
	);
	assert.deepEqual(validate({ ...savedEmail, ...savedNotifications }), {});
	assert.deepEqual(Object.keys(validate({ ...savedEmail, ...savedNotifications, port: "0" })), ["port"]);
	assert.deepEqual(Object.keys(validate({ ...savedEmail, ...savedNotifications, fromName: 'New "x"' })), [
		"fromName",
	]);
});
