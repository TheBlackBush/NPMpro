import assert from "node:assert/strict";
import { it } from "node:test";
import {
	ageText,
	canDelete,
	deleteBody,
	hasUnknownAge,
	initialSelection,
	keepSelection,
	resultCounts,
	resultLine,
	shortValue,
	VALUE_LIMIT,
} from "./DnsChallenges.js";

const item = (key, extra = {}) => ({
	key,
	name: `_acme-challenge.${key}`,
	id: key,
	values: ["v"],
	ageSeconds: 7200,
	recent: false,
	preselected: true,
	...extra,
});

it("ticks in advance only the preselected items of a known age", () => {
	const items = [
		item("old"),
		item("young", { preselected: false, ageSeconds: 120 }),
		// a record of unknown age is never ticked in advance, even when the answer says preselected
		item("unknown", { ageSeconds: null }),
	];
	assert.deepEqual([...initialSelection(items, false)], ["old"]);
});

it("ticks nothing while a request runs or without a list", () => {
	assert.equal(initialSelection([item("old")], true).size, 0);
	assert.equal(initialSelection(undefined, false).size, 0);
});

it("allows the delete only with a tick and no running request", () => {
	assert.equal(canDelete(new Set(["a"]), false), true);
	assert.equal(canDelete(new Set(["a"]), true), false);
	assert.equal(canDelete(new Set(), false), false);
	assert.equal(canDelete(undefined, false), false);
});

it("cuts a value to 40 characters and keeps a short one", () => {
	assert.equal(shortValue("abc"), "abc");
	assert.equal(shortValue("x".repeat(VALUE_LIMIT)), "x".repeat(VALUE_LIMIT));
	const cut = shortValue("y".repeat(100));
	assert.equal(cut.length, VALUE_LIMIT);
	assert.ok(cut.endsWith("…"));
	assert.equal(shortValue(undefined), "");
});

it("words an age by its size and says unknown without one", () => {
	assert.equal(ageText(null).id, "dns-challenges.age.unknown");
	assert.equal(ageText(undefined).id, "dns-challenges.age.unknown");
	assert.equal(ageText(-5).id, "dns-challenges.age.unknown");
	assert.equal(ageText(30).id, "dns-challenges.age.now");
	assert.deepEqual(ageText(125), { id: "dns-challenges.age.minutes", values: { count: 2 } });
	assert.deepEqual(ageText(7300), { id: "dns-challenges.age.hours", values: { count: 2 } });
	assert.deepEqual(ageText(3 * 86400 + 5), { id: "dns-challenges.age.days", values: { count: 3 } });
});

it("sends the ticked items as listed, in the list's order", () => {
	const items = [item("a"), item("b"), item("c", { id: null, values: ["x", "y"] })];
	assert.deepEqual(deleteBody(items, new Set(["c", "a"])), [
		{ name: "_acme-challenge.a", id: "a", values: ["v"] },
		{ name: "_acme-challenge.c", id: null, values: ["x", "y"] },
	]);
});

it("finds a ticked item of unknown age", () => {
	const items = [item("a"), item("b", { ageSeconds: null })];
	assert.equal(hasUnknownAge(items, new Set(["a"])), false);
	assert.equal(hasUnknownAge(items, new Set(["a", "b"])), true);
	assert.equal(hasUnknownAge(items), true);
});

it("drops the ticks of items that left the list or are in use", () => {
	const items = [item("a"), item("b")];
	assert.deepEqual([...keepSelection(new Set(["a", "z"]), items, false)], ["a"]);
	assert.equal(keepSelection(new Set(["a"]), items, true).size, 0);
});

it("shows a result per outcome", () => {
	assert.deepEqual(resultLine({ result: "deleted" }), {
		tone: "success",
		id: "dns-challenges.result.deleted",
		detail: null,
	});
	assert.equal(resultLine({ result: "gone" }).tone, "muted");
	assert.equal(resultLine({ result: "skipped", reason: "changed" }).id, "dns-challenges.result.skipped.changed");
	assert.equal(resultLine({ result: "skipped", reason: "outside" }).id, "dns-challenges.result.skipped.outside");
	assert.equal(resultLine({ result: "skipped" }).id, "dns-challenges.result.skipped.changed");
	assert.deepEqual(resultLine({ result: "failed", message: "denied" }), {
		tone: "destructive",
		id: "dns-challenges.result.failed",
		detail: "denied",
	});
	assert.equal(resultLine({ result: "failed", message: "" }).detail, null);
	// an outcome this version does not know reads as failed
	assert.equal(resultLine({ result: "other" }).tone, "destructive");
	assert.equal(resultLine(undefined).tone, "destructive");
});

it("counts the results and is ok only without a skip or a failure", () => {
	assert.deepEqual(resultCounts([{ result: "deleted" }, { result: "gone" }]), {
		deleted: 1,
		gone: 1,
		skipped: 0,
		failed: 0,
		ok: true,
	});
	const mixed = resultCounts([{ result: "deleted" }, { result: "skipped" }, { result: "failed" }, { result: "x" }]);
	assert.equal(mixed.failed, 2);
	assert.equal(mixed.skipped, 1);
	assert.equal(mixed.ok, false);
	assert.equal(resultCounts(undefined).ok, true);
});
