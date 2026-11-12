import assert from "node:assert/strict";
import { it } from "node:test";
import { BAN_TONES, banSegments, OTHER_TONE, shortScenario, topCountryRows } from "./DashboardCards.js";

const ends = (segments) => segments.at(-1).x + segments.at(-1).width;
const close = (a, b) => Math.abs(a - b) < 1e-9;

it("keeps up to five country rows, upper-case, and drops what is not a country code", () => {
	assert.deepEqual(
		topCountryRows([
			{ country: "de", requests: 10 },
			{ country: "--", requests: 9 },
			{ country: "US", requests: 8 },
			{ country: null, requests: 7 },
			{ country: "FR", requests: 4 },
			{ country: "NL", requests: 3 },
			{ country: "JP", requests: 2 },
			{ country: "BR", requests: 2 },
			{ country: "IN", requests: 1 },
		]),
		[
			{ code: "DE", requests: 10 },
			{ code: "US", requests: 8 },
			{ code: "FR", requests: 4 },
			{ code: "NL", requests: 3 },
			{ code: "JP", requests: 2 },
		],
	);
});

it("gives one or two rows for one or two countries and none for null", () => {
	assert.deepEqual(topCountryRows([{ country: "JP", requests: 2 }]), [{ code: "JP", requests: 2 }]);
	assert.deepEqual(topCountryRows(null), []);
	assert.deepEqual(topCountryRows(undefined), []);
	assert.deepEqual(topCountryRows([]), []);
});

it("shortens a scenario by its author prefix only", () => {
	assert.equal(shortScenario("crowdsecurity/http-probing"), "http-probing");
	assert.equal(shortScenario("TheBlackBush/npmpro-login-bf"), "npmpro-login-bf");
	assert.equal(shortScenario("a.b-c_d/x/y"), "x/y");
	assert.equal(shortScenario("manual 'ban' from 'host/1'"), "manual 'ban' from 'host/1'");
	assert.equal(shortScenario("firehol_cruzit_web_attacks"), "firehol_cruzit_web_attacks");
	assert.equal(shortScenario(""), "");
	assert.equal(shortScenario(null), "");
});

it("splits the bar into the reasons and other, gaps and minimum included, ending at 100", () => {
	const segments = banSegments(10, [
		{ scenario: "crowdsecurity/http-probing", count: 5 },
		{ scenario: "crowdsecurity/ssh-bf", count: 2 },
		{ scenario: "manual 'ban' from 'x'", count: 1 },
	]);
	assert.deepEqual(
		segments.map((s) => [s.key, s.short, s.count, s.tone]),
		[
			["crowdsecurity/http-probing", "http-probing", 5, BAN_TONES[0]],
			["crowdsecurity/ssh-bf", "ssh-bf", 2, BAN_TONES[1]],
			["manual 'ban' from 'x'", "manual 'ban' from 'x'", 1, BAN_TONES[2]],
			["other", null, 2, OTHER_TONE],
		],
	);
	assert.equal(segments[3].scenario, null);
	assert.equal(segments[0].x, 0);
	// 100 minus 3 gaps minus 4 minimum widths, shared by count: 89 * 5 / 10 = 44.5
	assert.ok(close(segments[0].width, 46.5));
	assert.ok(close(segments[1].x, 47.5));
	assert.ok(close(ends(segments), 100));
});

it("shows up to five reasons with their own tones, the sixth is cut, and other follows", () => {
	assert.equal(BAN_TONES.length, 5);
	assert.equal(new Set(BAN_TONES.map((t) => t.fill)).size, 5);
	const segments = banSegments(40, [
		{ scenario: "a/one", count: 9 },
		{ scenario: "a/two", count: 8 },
		{ scenario: "a/three", count: 7 },
		{ scenario: "a/four", count: 6 },
		{ scenario: "a/five", count: 1 },
		{ scenario: "a/six", count: 1 },
	]);
	assert.deepEqual(
		segments.map((s) => s.key),
		["a/one", "a/two", "a/three", "a/four", "a/five", "other"],
	);
	assert.deepEqual(
		segments.slice(0, 5).map((s) => s.tone),
		BAN_TONES,
	);
	assert.equal(segments[5].tone, OTHER_TONE);
	assert.ok(segments.every((s) => s.width >= 2));
	assert.ok(close(ends(segments), 100));
});

it("leaves other out when the reasons cover every ban, also when they count more than the total", () => {
	const exact = banSegments(4, [
		{ scenario: "a/x", count: 3 },
		{ scenario: "a/y", count: 1 },
	]);
	assert.deepEqual(
		exact.map((s) => [s.key, s.width]),
		[
			["a/x", 73.25],
			["a/y", 25.75],
		],
	);
	assert.ok(close(ends(exact), 100));
	// a poll between the two reads: other is never negative
	const over = banSegments(2, [{ scenario: "a/x", count: 3 }]);
	assert.deepEqual(
		over.map((s) => [s.key, s.x, s.width]),
		[["a/x", 0, 100]],
	);
});

it("gives a tiny reason its minimum width", () => {
	const segments = banSegments(10001, [{ scenario: "a/x", count: 1 }]);
	assert.ok(segments[0].width >= 2);
	assert.ok(close(ends(segments), 100));
});

it("has no segments without a reason, and skips empty or zero reasons", () => {
	assert.deepEqual(banSegments(5, []), []);
	assert.deepEqual(banSegments(5, null), []);
	assert.deepEqual(banSegments(null, undefined), []);
	assert.deepEqual(
		banSegments(3, [
			{ scenario: "", count: 2 },
			{ scenario: "a/x", count: 0 },
		]),
		[],
	);
});
