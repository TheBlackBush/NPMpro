import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import { createValidations, HOST_PATTERN, upstreamUrlPattern } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

it("keeps the messages of the field rules", () => {
	assert.equal(rules.validateString(1, 255)("  "), "This is required");
	assert.equal(rules.validateString(8, 255, false)("short"), "Minimum length is 8 characters");
	assert.equal(rules.validateString(1, 3)("abcd"), "Maximum length is 3 characters");
	assert.equal(rules.validateEmail()("ab"), "Invalid email address");
	assert.equal(rules.validateInteger({ min: 0, max: 7200 })("7201"), "Enter a whole number from 0 to 7200");
	assert.equal(rules.validateRequired()(undefined), "This is required");
	assert.equal(rules.validateFile()({ size: 2 * 1024 * 1024 }), "The upload is too large, the maximum is 1 MiB");
	assert.equal(rules.validateDomains(false, true)(["*.example.com"]), "Invalid domain: *.example.com");
	assert.equal(rules.validateDomains(true, true)(["*.example.com"]), undefined);
	assert.equal(rules.message("error.passwords-must-match"), "Passwords must match");
});

it("keeps the patterns", () => {
	assert.equal(HOST_PATTERN.test("example.com"), true);
	assert.equal(upstreamUrlPattern.test("http://auth:9000"), true);
});
