import assert from "node:assert/strict";
import { it } from "node:test";
import {
	addressListValidate,
	alertEventGroups,
	browserPublicUrl,
	configErrorItems,
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
	refusedAddressOf,
	reminderHoursValidate,
	sampleFailureOf,
	sendsPlainLogin,
	stillRefused,
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
	assert.deepEqual(values, {
		...notificationValues({}),
		publicUrl: "https://npm.example.com",
		defaultLanguage: "de",
	});
	assert.equal(notificationPayload(values, data), null);
	assert.deepEqual(notificationPayload({ ...values, publicUrl: " ", defaultLanguage: "fr" }, data), {
		publicUrl: "",
		defaultLanguage: "fr",
	});
	assert.equal(notificationPayload({ ...values, publicUrl: "x" }, { ...data, locked: ["public_url"] }), null);
	assert.deepEqual(notificationValues({}), {
		publicUrl: "",
		defaultLanguage: "en",
		alertsAdmins: true,
		alertsAddresses: [],
		alertsEvents: [],
		reminderHours: "24",
	});
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

it("names the saved values the sender refuses with the field's label and text, never a raw or unknown key", () => {
	assert.deepEqual(configErrorItems({ configErrors: ["from_address", "nope"] }, { configErrors: ["public_url"] }), [
		{ field: "from_address", label: "settings.email.from-address", error: "settings.email.from-address.invalid" },
		{
			field: "public_url",
			label: "settings.notifications.public-url",
			error: "settings.notifications.public-url.invalid",
		},
	]);
	assert.deepEqual(configErrorItems({}, undefined), []);
	assert.deepEqual(configErrorItems({ configErrors: ["toString"] }, {}), []);
});

const EVENTS = [
	{ id: "certificate.expiring", kind: "state", channels: ["mail", "webhook"] },
	{ id: "certificate.renewal_failed", kind: "state", channels: ["mail", "webhook"] },
	{ id: "certificate.renewal_failed.resolved", kind: "state", channels: ["webhook"] },
	{ id: "host.created", kind: "action", channels: ["webhook"] },
	{ id: "host.config_error", kind: "state", channels: ["mail", "webhook"] },
	{ id: "ddns.record_failed", kind: "state", channels: ["mail", "webhook"] },
	{ id: "webhook.disabled", kind: "action", channels: ["mail", "webhook"] },
	{ id: "future.event", kind: "state", channels: ["mail"] },
];

it("groups the events mail offers by area, without recoveries, action events or events the UI has no line for", () => {
	const groups = alertEventGroups(EVENTS);
	assert.deepEqual(
		groups.map((group) => [group.area, group.events.map((event) => event.id)]),
		[
			["certificates", ["certificate.expiring", "certificate.renewal_failed"]],
			["hosts", ["host.config_error"]],
			["ddns", ["ddns.record_failed"]],
			["webhooks", ["webhook.disabled"]],
		],
	);
	assert.equal(groups[0].title, "settings.notifications.alerts.area.certificates");
	assert.equal(groups[0].events[0].label, "settings.notifications.alerts.event.certificate-expiring");
	assert.deepEqual(alertEventGroups(undefined), []);
	assert.deepEqual(alertEventGroups([{ id: "host.created", channels: ["webhook"] }]), []);
});

it("checks the extra alert addresses: at most 20, each one plain address", () => {
	assert.equal(addressListValidate([]), null);
	assert.equal(addressListValidate(["a@b.example", "c@d.example"]), null);
	assert.deepEqual(addressListValidate(["a@b.example", "Name <x@y.example>"]), {
		id: "settings.notifications.alerts-addresses.refused",
		values: { address: "Name <x@y.example>" },
	});
	const many = Array.from({ length: 21 }, (_, index) => `u${index}@b.example`);
	assert.deepEqual(addressListValidate(many), {
		id: "settings.notifications.alerts-addresses.too-many",
		values: { max: 20 },
	});
	assert.equal(addressListValidate(many.slice(0, 20)), null);
});

it("checks the reminder hours: a whole number from 0 to 168", () => {
	for (const ok of ["0", "24", " 168 "]) assert.equal(reminderHoursValidate(ok), null, ok);
	for (const bad of ["", "-1", "1.5", "169", "x", "1e2"]) {
		assert.equal(reminderHoursValidate(bad), "settings.notifications.reminder-hours.invalid", bad);
	}
});

it("validates the alert fields unless the environment sets them or the stored value is kept", () => {
	const none = () => false;
	const base = { ...emailValues(stored), ...notificationValues({}) };
	const validate = (values, isLocked = none, saved = {}) =>
		notificationsValidate(
			rules,
			{ isEmailLocked: none, isNotificationsLocked: isLocked },
			saved,
		)({ ...base, ...values });
	assert.deepEqual(validate({}), {});
	assert.deepEqual(Object.keys(validate({ alertsAddresses: ["bad"], reminderHours: "200" })), [
		"alertsAddresses",
		"reminderHours",
	]);
	assert.equal(
		validate({ reminderHours: "x" }).reminderHours,
		'settings.notifications.reminder-hours.invalid{"max":168}',
	);
	assert.deepEqual(
		validate({ alertsAddresses: ["bad"], reminderHours: "x" }, () => true),
		{},
	);
	// a legacy stored list passes while it is kept as stored
	const savedNotifications = notificationValues({ alertsAddresses: ["legacy"], reminderHours: 500 });
	assert.deepEqual(validate(savedNotifications, none, { savedNotifications }), {});
});

it("sends the changed alert settings only, the events as the offered ones", () => {
	const data = {
		alertsAdmins: true,
		alertsAddresses: ["a@b.example"],
		alertsEvents: ["certificate.expiring", "host.config_error"],
		reminderHours: 24,
		locked: [],
	};
	const values = notificationValues(data);
	assert.equal(notificationPayload(values, data, EVENTS), null);
	// the same events in another order are no change
	assert.equal(
		notificationPayload({ ...values, alertsEvents: ["host.config_error", "certificate.expiring"] }, data, EVENTS),
		null,
	);
	assert.deepEqual(
		notificationPayload(
			{
				...values,
				alertsAdmins: false,
				alertsAddresses: [" a@b.example ", "c@d.example"],
				alertsEvents: ["certificate.expiring", "gone.event", "backup.failed"],
				reminderHours: " 0 ",
			},
			data,
			EVENTS.concat({ id: "backup.failed", kind: "state", channels: ["mail"] }),
		),
		{
			alertsAdmins: false,
			alertsAddresses: ["a@b.example", "c@d.example"],
			alertsEvents: ["certificate.expiring", "backup.failed"],
			reminderHours: 0,
		},
	);
	// no list of offered events yet: the ticked ids go as they are
	assert.deepEqual(notificationPayload({ ...values, alertsEvents: ["x"] }, data), { alertsEvents: ["x"] });
	// the addresses set by the environment are never sent
	assert.equal(
		notificationPayload({ ...values, alertsAddresses: ["z@y.example"] }, { ...data, locked: ["alerts_addresses"] }),
		null,
	);
});

it("names the refused address of a save and the failing address of a sample", () => {
	const refusal = (index, address) => ({
		payload: {
			error: {
				message_i18n: "settings.notifications.alerts-addresses.invalid",
				message_values: { index, address },
			},
		},
	});
	assert.equal(refusedAddressOf(refusal(1, "bad"), ["a@b.example", "bad"]), "bad");
	assert.equal(refusedAddressOf(refusal(5, "gone"), ["a@b.example"]), null);
	assert.equal(refusedAddressOf(refusal(1), ["a@b.example", "bad"]), null);
	// the backend removes a repeat in another case first: its index 1 is the third address of the list sent, the
	// address it names is the one marked, in the spelling of the list
	assert.equal(refusedAddressOf(refusal(1, "x@Bad"), ["Ops@example.com", "ops@example.com", "x@bad"]), "x@bad");
	assert.equal(refusedAddressOf({ payload: { error: { message_i18n: "other" } } }, ["x"]), null);
	assert.equal(refusedAddressOf(new Error("x"), ["x"]), null);
	const failed = {
		payload: {
			error: {
				message_i18n: "error.mail-test-failed",
				message_values: { address: "a@b.example", failed: 2, sent: 1 },
			},
		},
	};
	assert.deepEqual(sampleFailureOf(failed), { address: "a@b.example", sent: 1, failed: 2, skipped: 0 });
	assert.equal(sampleFailureOf({ payload: { error: { message_i18n: "error.notify-no-recipients" } } }), null);
	assert.equal(sampleFailureOf(undefined), null);
});

it("names the alert settings the sender refuses", () => {
	assert.deepEqual(configErrorItems({}, { configErrors: ["alerts_addresses", "reminder_hours"] }), [
		{
			field: "alerts_addresses",
			label: "settings.notifications.alerts-addresses",
			error: "settings.notifications.alerts-addresses.invalid",
		},
		{
			field: "reminder_hours",
			label: "settings.notifications.reminder-hours",
			error: "settings.notifications.reminder-hours.invalid",
		},
	]);
});

it("keeps the refused address marked only while it is in the list", () => {
	assert.equal(stillRefused("bad", ["a@b.example", "bad"]), "bad");
	assert.equal(stillRefused("bad", ["a@b.example"]), null);
	assert.equal(stillRefused(null, ["bad"]), null);
	assert.equal(stillRefused("bad", undefined), null);
});
