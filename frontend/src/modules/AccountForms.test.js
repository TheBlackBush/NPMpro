import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	CODE_VALUES,
	changePasswordValidate,
	codeComplete,
	codeModeChanges,
	codeOf,
	fittingOtpSize,
	mfaCodeValidate,
	normalizeBackupCode,
	pastedCodeValue,
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

it("two-factor codes: the six digits of the app; turning it off also takes a backup code", () => {
	for (const step of ["setup", "verify", "disable"]) {
		const validate = mfaCodeValidate(rules, step);
		assert.deepEqual(validate({ ...CODE_VALUES }), { code: "This is required" });
		assert.deepEqual(validate({ ...CODE_VALUES, code: "12345" }), { code: "Enter the 6-digit code" });
		assert.deepEqual(validate({ ...CODE_VALUES, code: "12a456" }), { code: "Enter the 6-digit code" });
		assert.deepEqual(validate({ ...CODE_VALUES, code: "123456" }), {});
	}
	const disable = mfaCodeValidate(rules, "disable");
	const backup = (backupCode) => disable({ ...CODE_VALUES, useBackup: true, backupCode });
	assert.deepEqual(backup(""), { backupCode: "This is required" });
	assert.deepEqual(backup("ABCD123"), { backupCode: "Enter the 8 letters and digits of a backup code" });
	assert.deepEqual(backup("ABCD12345"), { backupCode: "Enter the 8 letters and digits of a backup code" });
	assert.deepEqual(backup("abcd-1234"), {});
	assert.deepEqual(backup(" 7k3m 9q2z "), {});
	// setup and renewal take no backup code, whatever the switch says
	assert.deepEqual(mfaCodeValidate(rules, "verify")({ ...CODE_VALUES, useBackup: true, backupCode: "ABCD1234" }), {
		code: "This is required",
	});
});

it("two-factor codes: the code sent, when it is complete, and the switch to a backup code", () => {
	assert.equal(normalizeBackupCode(" ab cd-12 34 "), "ABCD1234");
	assert.equal(normalizeBackupCode(undefined), "");
	assert.equal(codeOf({ ...CODE_VALUES, code: "123456" }), "123456");
	assert.equal(codeOf({ code: "123456", backupCode: "abcd-1234", useBackup: true }), "ABCD1234");
	assert.equal(codeComplete({ ...CODE_VALUES, code: "12345" }), false);
	assert.equal(codeComplete({ ...CODE_VALUES, code: "123456" }), true);
	assert.equal(codeComplete({ code: "123456", backupCode: "abcd123", useBackup: true }), false);
	assert.equal(codeComplete({ code: "", backupCode: "abcd 1234", useBackup: true }), true);
	assert.equal(codeComplete({ code: "", backupCode: "abcd1234", useBackup: true }), true);
	// the field the switch shows starts empty; the other keeps its value until the switch comes back
	assert.deepEqual(codeModeChanges(true), { useBackup: true, backupCode: "" });
	assert.deepEqual(codeModeChanges(false), { useBackup: false, code: "" });
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

it("pastedCodeValue puts a partial paste at the caret and a complete code over the whole value", () => {
	assert.equal(pastedCodeValue("12", "34", 2, 2, 6), "1234");
	assert.equal(pastedCodeValue("1234", "98", 1, 3, 6), "1984");
	assert.equal(pastedCodeValue("123456", "654 321", 3, 3, 6), "654321");
	assert.equal(pastedCodeValue("abcd1234", "WXYZ-9876", 8, 8, 8), "WXYZ9876");
	assert.equal(pastedCodeValue("", "98 76-54", 0, 0, 6), "987654");
});

it("fittingOtpSize takes the largest size that fits, the smallest when none does", () => {
	const widths = { lg: 400, md: 340, sm: 300 };
	const sizes = [["lg"], ["md"], ["sm"]];
	const widthOf = ([name]) => widths[name];
	assert.deepEqual(fittingOtpSize(sizes, widthOf, 500), ["lg"]);
	assert.deepEqual(fittingOtpSize(sizes, widthOf, 340), ["md"]);
	assert.deepEqual(fittingOtpSize(sizes, widthOf, 310), ["sm"]);
	assert.deepEqual(fittingOtpSize(sizes, widthOf, 100), ["sm"]);
});
