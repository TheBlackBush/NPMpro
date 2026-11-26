import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { alertRecipients } from "../lib/mail/recipients.js";

const admin = (email, extra = {}) => ({ email, roles: ["admin"], is_disabled: 0, ...extra });
const settings = (extra = {}) => ({ alerts_admins: true, alerts_addresses: [], default_language: "en", ...extra });

describe("alertRecipients", () => {
	it("takes enabled administrators with their own language, else the default language", () => {
		const found = alertRecipients({
			admins: [
				admin("a@example.com", { npmpro_language: "de" }),
				admin("b@example.com", { npmpro_language: "xx" }),
			],
			settings: settings({ default_language: "fr" }),
		});
		assert.deepEqual(found, [
			{ address: "a@example.com", language: "de" },
			{ address: "b@example.com", language: "fr" },
		]);
	});

	it("skips a disabled administrator, a user who is not an administrator and an invalid address", () => {
		const found = alertRecipients({
			admins: [
				admin("off@example.com", { is_disabled: 1 }),
				{ email: "user@example.com", roles: [], is_disabled: 0 },
				admin("x@"),
				admin("two@example.com, three@example.com"),
				admin("ok@example.com"),
			],
			settings: settings(),
		});
		assert.deepEqual(found, [{ address: "ok@example.com", language: "en" }]);
	});

	it("keeps one entry for a listed address that equals an administrator's in another case, the administrator's language", () => {
		const found = alertRecipients({
			admins: [admin("Boss@Example.com", { npmpro_language: "de" })],
			settings: settings({ alerts_addresses: ["boss@example.COM", "Other@example.com", "other@EXAMPLE.com"] }),
		});
		assert.deepEqual(found, [
			{ address: "Boss@Example.com", language: "de" },
			{ address: "Other@example.com", language: "en" },
		]);
	});

	it("takes a listed address on its own, and no administrator when alerts_admins is off", () => {
		const found = alertRecipients({
			admins: [admin("a@example.com")],
			settings: settings({
				alerts_admins: false,
				alerts_addresses: ["list@example.com"],
				default_language: "it",
			}),
		});
		assert.deepEqual(found, [{ address: "list@example.com", language: "it" }]);
	});

	it("answers nobody for missing input", () => {
		assert.deepEqual(alertRecipients({ admins: undefined, settings: undefined }), []);
	});
});
