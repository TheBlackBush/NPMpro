import assert from "node:assert/strict";
import { it } from "node:test";
import { BAN_TONES, banSegments, errorSegments, OTHER_TONE, shortScenario, topCountryRows } from "./DashboardCards.js";

const ends = (segments) => segments.at(-1).x + segments.at(-1).width;
const close = (a, b) => Math.abs(a - b) < 1e-9;

it("keeps up to seven country rows, upper-case, and drops what is not a country code", () => {
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
			{ country: "AU", requests: 1 },
		]),
		[
			{ code: "DE", requests: 10 },
			{ code: "US", requests: 8 },
			{ code: "FR", requests: 4 },
			{ code: "NL", requests: 3 },
			{ code: "JP", requests: 2 },
			{ code: "BR", requests: 2 },
			{ code: "IN", requests: 1 },
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
			["crowdsecurity/ssh-bf", "ssh-bf", 2, BAN_TONES[2]],
			["manual 'ban' from 'x'", "manual 'ban' from 'x'", 1, BAN_TONES[4]],
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

it("shows up to five reasons, the sixth is cut, and other follows", () => {
	assert.equal(BAN_TONES.length, 5);
	assert.equal(new Set(BAN_TONES.map((t) => t.fill)).size, 5);
	assert.equal(BAN_TONES[4].fill, "fill-[#f3b01d]");
	const segments = banSegments(40, [
		{ scenario: "a/one", count: 9 },
		{ scenario: "a/two", count: 8 },
		{ scenario: "a/three", count: 7 },
		{ scenario: "a/four", count: 6 },
		{ scenario: "a/five", count: 1 },
		{ scenario: "a/six", count: 1 },
	]);
	assert.deepEqual(
		segments.map((s) => [s.key, s.count]),
		[
			["a/one", 9],
			["a/two", 8],
			["a/three", 7],
			["a/four", 6],
			["a/five", 1],
			["other", 9],
		],
	);
	assert.deepEqual(
		segments.slice(0, 5).map((s) => s.tone),
		BAN_TONES,
	);
	assert.equal(segments[5].tone, OTHER_TONE);
	assert.ok(segments.every((s) => s.width >= 2));
	assert.ok(close(ends(segments), 100));
});

it("spreads the tones by the number of reasons: red first, the yellow last", () => {
	const two = banSegments(3, [
		{ scenario: "a/one", count: 2 },
		{ scenario: "a/two", count: 1 },
	]);
	assert.deepEqual(
		two.map((s) => s.tone),
		[BAN_TONES[0], BAN_TONES[4]],
	);
	const four = banSegments(4, [
		{ scenario: "a/one", count: 1 },
		{ scenario: "a/two", count: 1 },
		{ scenario: "a/three", count: 1 },
		{ scenario: "a/four", count: 1 },
	]);
	assert.deepEqual(
		four.map((s) => s.tone),
		[BAN_TONES[0], BAN_TONES[1], BAN_TONES[3], BAN_TONES[4]],
	);
});

it("splits the error bar into 4xx in the yellow and 5xx in red, ending at 100", () => {
	const segments = errorSegments(30, 10);
	assert.deepEqual(
		segments.map((s) => [s.key, s.label, s.count, s.tone]),
		[
			["4xx", "4xx", 30, BAN_TONES[4]],
			["5xx", "5xx", 10, BAN_TONES[0]],
		],
	);
	// 100 minus 1 gap minus 2 minimum widths, shared by count: 95 * 30 / 40 = 71.25
	assert.ok(close(segments[0].width, 73.25));
	assert.ok(close(segments[1].x, 74.25));
	assert.ok(close(ends(segments), 100));
});

it("keeps both error classes in the legend, a class without answers takes no room in the bar", () => {
	const only5xx = errorSegments(0, 3);
	assert.deepEqual(
		only5xx.map((s) => [s.key, s.count, s.width]),
		[
			["4xx", 0, 0],
			["5xx", 3, 100],
		],
	);
	assert.deepEqual(
		errorSegments(null, undefined).map((s) => [s.key, s.count, s.x, s.width]),
		[
			["4xx", 0, 0, 0],
			["5xx", 0, 0, 0],
		],
	);
	assert.deepEqual(
		errorSegments(-2, "x").map((s) => s.count),
		[0, 0],
	);
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
