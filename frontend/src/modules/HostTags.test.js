import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	addTag,
	canonicalTags,
	hasAllTags,
	isValidTag,
	removeTag,
	TAGS_MAX,
	tagInputMessage,
	tagNames,
	tagOptions,
	tagsError,
} from "./HostTags.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

it("accepts letters of any script, with marks, digits, spaces inside, - _ and .", () => {
	for (const tag of [
		"Prod",
		"home lab",
		"v1.2",
		"a_b-c",
		"café",
		"東京",
		"खाना",
		"Ünïcode",
		"x".repeat(32),
		"𝐀".repeat(32),
		"-",
	]) {
		assert.equal(isValidTag(tag), true, tag);
	}
	assert.equal(isValidTag("  padded  "), true, "trimmed first");
	for (const tag of ["", "   ", "a/b", "a,b", "a#b", "x".repeat(33), "𝐀".repeat(33), "emoji 🙂", 'quote"']) {
		assert.equal(isValidTag(tag), false, tag);
	}
});

it("suggests each tag once, first spelling, sorted", () => {
	assert.deepEqual(tagNames([{ npmproTags: ["Prod", "lab"] }], undefined, [{ npmproTags: ["prod", "Alpha"] }, {}]), [
		"Alpha",
		"lab",
		"Prod",
	]);
});

it("offers the suggestions a field does not hold yet, in any case", () => {
	assert.deepEqual(tagOptions(["Alpha", "Prod"], ["prod"]), [{ label: "Alpha", value: "Alpha" }]);
});

it("matches picked tags in any case, all of them", () => {
	assert.equal(hasAllTags(["Prod", "Lab"], ["prod"]), true);
	assert.equal(hasAllTags(["Prod", "Lab"], ["PROD", "lab"]), true);
	assert.equal(hasAllTags(["Prod"], ["Prod", "Lab"]), false);
	assert.equal(hasAllTags(undefined, ["Prod"]), false);
	assert.equal(hasAllTags(["Prod"], []), true);
});

it("reads wanted tags as the known spelling, once, unknown ones dropped", () => {
	assert.deepEqual(canonicalTags(["prod", "PROD", "gone", "Lab"], ["Prod", "Lab"]), ["Prod", "Lab"]);
});

it("adds and removes a tag in any case", () => {
	assert.deepEqual(addTag(["Prod"], "prod"), ["Prod"]);
	assert.deepEqual(addTag(["Prod"], "Lab"), ["Prod", "Lab"]);
	assert.deepEqual(removeTag(["Prod", "Lab"], "lab"), ["Prod"]);
});

it("names the first bad tag and the limit", () => {
	assert.equal(tagsError(rules, ["ok", "café"]), undefined);
	assert.match(tagsError(rules, ["ok", "a/b"]), /“a\/b”/u);
	assert.match(
		tagsError(
			rules,
			Array.from({ length: TAGS_MAX + 1 }, (_, n) => `t${n}`),
		),
		/10/u,
	);
});

it("says why a typed tag cannot be added", () => {
	assert.deepEqual(tagInputMessage("", 0), { id: "host.tags.none", values: {} });
	assert.deepEqual(tagInputMessage("a/b", 1), { id: "error.tag-invalid", values: { tag: "a/b" } });
	assert.deepEqual(tagInputMessage("ok", TAGS_MAX), { id: "error.tags-too-many", values: { max: TAGS_MAX } });
});

it("takes a missing list, host, tag or input as empty", () => {
	assert.equal(isValidTag(undefined), false);
	assert.equal(isValidTag(null), false);
	assert.deepEqual(tagNames(undefined, null, [{ npmproTags: ["a"] }, {}, null]), ["a"]);
	assert.deepEqual(tagOptions(["a", "b"], undefined), [
		{ label: "a", value: "a" },
		{ label: "b", value: "b" },
	]);
	assert.equal(hasAllTags(undefined, undefined), true);
	assert.equal(hasAllTags(undefined, ["a"]), false);
	assert.deepEqual(canonicalTags(undefined, ["a"]), []);
	assert.deepEqual(canonicalTags(["A"], undefined), []);
	assert.equal(tagsError(rules, undefined), undefined);
	assert.deepEqual(tagInputMessage(undefined, 0), { id: "host.tags.none", values: {} });
});
