import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	changePasswordValidate,
	mfaCodeValidate,
	setPasswordValidate,
	setupValidate,
	userValidate,
} from "./AccountForms.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

it("change password: the same errors as the Formik fields and validate", () => {
	const validate = changePasswordValidate(rules);
	assert.deepEqual(validate({ current: "", new: "", confirm: "" }), {
		current: "This is required",
		new: "This is required",
		confirm: "This is required",
	});
	assert.deepEqual(validate({ current: "x", new: "short", confirm: "short" }), {
		new: "Minimum length is 8 characters",
		confirm: "Minimum length is 8 characters",
	});
	// the form's own rule wins over the repeat's length rule, as Formik merged them
	assert.deepEqual(validate({ current: "x", new: "long enough", confirm: "abc" }), {
		confirm: "Passwords must match",
	});
	assert.deepEqual(validate({ current: "x", new: "long enough", confirm: "long enough" }), {});
	// untrimmed: eight spaces are a valid password
	assert.deepEqual(validate({ current: " ", new: "        ", confirm: "        " }), {});
});

it("set password: eight characters or more", () => {
	const validate = setPasswordValidate(rules);
	assert.deepEqual(validate({ new: "" }), { new: "This is required" });
	assert.deepEqual(validate({ new: "1234567" }), { new: "Minimum length is 8 characters" });
	assert.deepEqual(validate({ new: "12345678" }), {});
});

it("two-factor codes: six digits to turn on or renew, 6 to 8 characters to turn off", () => {
	for (const step of ["setup", "verify"]) {
		const validate = mfaCodeValidate(rules, step);
		assert.deepEqual(validate({ code: "" }), { code: "This is required" });
		assert.deepEqual(validate({ code: "12345" }), { code: "Enter the 6-digit code" });
		assert.deepEqual(validate({ code: "12a456" }), { code: "Enter the 6-digit code" });
		assert.deepEqual(validate({ code: " 123456 " }), {});
	}
	const disable = mfaCodeValidate(rules, "disable");
	assert.deepEqual(disable({ code: "" }), { code: "This is required" });
	assert.deepEqual(disable({ code: "12345" }), { code: "Minimum length is 6 characters" });
	assert.deepEqual(disable({ code: "123456789" }), { code: "Maximum length is 8 characters" });
	assert.deepEqual(disable({ code: "abcd-123" }), {});
});

it("user: a name and an email address", () => {
	const validate = userValidate(rules);
	assert.deepEqual(validate({ name: " ", email: "" }), { name: "This is required", email: "This is required" });
	assert.deepEqual(validate({ name: "Ann", email: "ab" }), { email: "Invalid email address" });
	assert.deepEqual(validate({ name: "Ann", email: "a@b" }), {});
	assert.deepEqual(validate({ name: "x".repeat(256), email: "a@b" }), { name: "Maximum length is 255 characters" });
});

it("setup: a name, an email address and a password of eight characters or more", () => {
	const validate = setupValidate(rules);
	assert.deepEqual(validate({ name: "", email: "", password: "" }), {
		name: "This is required",
		email: "This is required",
		password: "This is required",
	});
	assert.deepEqual(validate({ name: " ", email: "ab", password: "1234567" }), {
		name: "This is required",
		email: "Invalid email address",
		password: "Minimum length is 8 characters",
	});
	assert.deepEqual(validate({ name: "Ann", email: "a@b", password: "        " }), {});
	assert.deepEqual(validate({ name: "Ann", email: "a@b", password: "x".repeat(256) }), {
		password: "Maximum length is 255 characters",
	});
});
