import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { avatarColor, avatarColors, colorIndex, defaultAvatar, hasNoPicture, initials } from "./Avatar.js";
import { contrastRatio, parseHex } from "./ColorContrast.js";

describe("initials", () => {
	it("takes the first letter of one word", () => {
		assert.equal(initials("alice"), "A");
	});
	it("takes the first and the last word of several", () => {
		assert.equal(initials("ada Lovelace"), "AL");
		assert.equal(initials("Jean Claude van Damme"), "JD");
	});
	it("ignores extra spaces", () => {
		assert.equal(initials("   ada    byron   lovelace  "), "AL");
		assert.equal(initials("  bob "), "B");
	});
	it("works for non-Latin scripts", () => {
		assert.equal(initials("иван петров"), "ИП");
		assert.equal(initials("山田 太郎"), "山太");
		assert.equal(initials("ünal"), "Ü");
	});
	it("uses a whole emoji, not half a surrogate pair", () => {
		assert.equal(initials("😀 Smile"), "😀S");
		assert.equal(initials("👨‍👩‍👧"), "👨‍👩‍👧");
		for (const char of initials("😀")) assert.notEqual(char, "\ud83d");
	});
	it("falls back to the email, then to nothing", () => {
		assert.equal(initials("", "zed@example.com"), "Z");
		assert.equal(initials("   ", "zed@example.com"), "Z");
		assert.equal(initials(null, "zed@example.com"), "Z");
		assert.equal(initials("", ""), "");
		assert.equal(initials(undefined, undefined), "");
		assert.equal(initials("  ", "  "), "");
	});
});

describe("hasNoPicture", () => {
	it("is true for empty, missing and the default path", () => {
		assert.equal(hasNoPicture(""), true);
		assert.equal(hasNoPicture(null), true);
		assert.equal(hasNoPicture(undefined), true);
		assert.equal(hasNoPicture(defaultAvatar), true);
		assert.equal(defaultAvatar, "/images/default-avatar.jpg");
	});
	it("is false for any other URL", () => {
		assert.equal(hasNoPicture("/avatars/a.jpg"), false);
		assert.equal(hasNoPicture("https://www.gravatar.com/avatar/abc"), false);
		assert.equal(hasNoPicture("/images/default-avatar.jpg?x=1"), false);
	});
});

describe("colour", () => {
	it("is stable for a name and within the palette", () => {
		assert.equal(colorIndex("Ada Lovelace"), colorIndex("Ada Lovelace"));
		assert.equal(avatarColor("Ada Lovelace"), avatarColor("  Ada Lovelace "));
		for (const name of ["a", "b", "Ada", "😀", "山田", "x@y.z"]) {
			const index = colorIndex(name);
			assert.ok(Number.isInteger(index) && index >= 0 && index < avatarColors.length);
		}
	});
	it("uses the email when there is no name, and spreads names over the palette", () => {
		assert.equal(colorIndex("", "a@b.c"), colorIndex("a@b.c"));
		const used = new Set(Array.from({ length: 200 }, (_, i) => colorIndex(`user ${i}`)));
		assert.ok(used.size >= avatarColors.length - 1);
	});
	it("keeps AA contrast (4.5:1) of the text on every background and lists its classes", () => {
		for (const { bg, text, className } of avatarColors) {
			assert.ok(contrastRatio(parseHex(bg), parseHex(text)) >= 4.5, `${bg} with ${text}`);
			assert.equal(className, `bg-[${bg}] text-[${text}]`);
		}
	});
});
