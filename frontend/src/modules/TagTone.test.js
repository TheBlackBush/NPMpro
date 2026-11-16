import assert from "node:assert/strict";
import { it } from "node:test";
import { TAG_TONES, tagTone, tagToneClass } from "./TagTone.js";

it("gives a tag the same tone whatever its case or surrounding spaces", () => {
	assert.equal(tagTone("Prod"), tagTone("prod"));
	assert.equal(tagTone(" PROD "), tagTone("prod"));
});

it("keeps every tone in range and uses all of them", () => {
	const seen = new Set();
	for (let n = 0; n < 200; n++) {
		const tone = tagTone(`tag-${n}`);
		assert.ok(Number.isInteger(tone) && tone >= 0 && tone < TAG_TONES);
		seen.add(tone);
	}
	assert.equal(seen.size, TAG_TONES);
});

it("keeps the tone of fixed names stable", () => {
	assert.equal(tagTone("prod"), 4);
	assert.equal(tagTone("home lab"), 9);
	assert.equal(tagTone("IoT"), 5);
	assert.equal(tagTone("Привет"), 9);
});

it("builds the class pair of a tag", () => {
	assert.equal(tagToneClass("prod"), `tag-tone tag-tone-${tagTone("prod")}`);
});

it("gives a missing name a tone", () => {
	assert.equal(tagTone(undefined), tagTone(""));
	assert.equal(tagTone(null), tagTone(""));
});
