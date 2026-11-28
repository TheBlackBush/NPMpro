import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertAccessListRules, assertCountryRules, clientsWithAddress } from "../lib/access-list-rules.js";

it("refuses a username twice", () => {
	const items = [
		{ username: "admin", password: "a" },
		{ username: "admin", password: "b" },
	];
	assert.throws(() => assertAccessListRules({ items }), { message_i18n: "error.access.duplicate-usernames" });
	assert.doesNotThrow(() =>
		assertAccessListRules({
			items: [
				{ username: "admin", password: "a" },
				{ username: "Admin", password: "" },
			],
		}),
	);
});

it("accepts an all rule only as the last rule", () => {
	const allowAll = { directive: "allow", address: "all" };
	const denyAll = { directive: "deny", address: "ALL" };
	const lan = { directive: "allow", address: "192.168.0.0/24" };
	const misplaced = { name: "ValidationError", message_i18n: "error.access.all-rule-last" };
	assert.throws(() => assertAccessListRules({ clients: [allowAll, lan] }), misplaced);
	assert.throws(() => assertAccessListRules({ clients: [lan, allowAll, denyAll] }), misplaced);
	// rows without an address are dropped, so they do not count as the last rule
	assert.doesNotThrow(() => assertAccessListRules({ clients: [lan, denyAll, { directive: "allow", address: "" }] }));
	assert.doesNotThrow(() => assertAccessListRules({ clients: [lan, denyAll] }));
	assert.doesNotThrow(() => assertAccessListRules({ clients: [lan] }));
	assert.doesNotThrow(() => assertAccessListRules({ clients: [] }));
});

it("checks only what the request sends", () => {
	assert.doesNotThrow(() => assertAccessListRules({}));
	assert.doesNotThrow(() => assertAccessListRules({ name: "x" }));
});

it("drops rules without an address", () => {
	assert.deepEqual(
		clientsWithAddress([
			{ directive: "allow", address: "" },
			{ directive: "allow", address: " " },
			{ directive: "allow", address: "10.0.0.1" },
			{ directive: "deny", address: "all" },
		]),
		[
			{ directive: "allow", address: "10.0.0.1" },
			{ directive: "deny", address: "all" },
		],
	);
	assert.deepEqual(clientsWithAddress(undefined), []);
});

const on = { available: true };
const off = { available: false };
const countries = (...codes) => codes.map((country) => ({ country, npmpro_comment: "" }));
const saved = (mode, ...codes) => ({ npmpro_geo_mode: mode, npmpro_countries: countries(...codes) });
const keyOf = (fn) => {
	try {
		fn();
	} catch (error) {
		return error.message_i18n;
	}
	return null;
};

describe("assertCountryRules", () => {
	it("checks nothing the request does not send", () => {
		assert.equal(
			keyOf(() => assertCountryRules({ name: "x" }, saved("allow", "ZZ"), off)),
			null,
		);
	});

	it("refuses a mode with no country and a duplicate or unknown code", () => {
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "allow", npmpro_countries: [] }, null, on)),
			"error.access.country-mode-empty",
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "deny" }, saved("off"), on)),
			"error.access.country-mode-empty",
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_countries: countries("DE", "DE") }, null, on)),
			"error.access.country-duplicate",
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_countries: countries("QQ") }, null, on)),
			"error.access.country-unknown",
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_countries: countries("XK") }, null, on)),
			null,
		);
	});

	it("carries the code in the unknown error", () => {
		assert.throws(() => assertCountryRules({ npmpro_countries: countries("QQ") }, null, on), {
			message_values: { code: "QQ" },
		});
	});

	it("keeps a stored code outside the list", () => {
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_countries: countries("ZZ", "DE") }, saved("deny", "ZZ", "DE"), on)),
			null,
		);
	});

	it("without a database refuses only turning a mode on, changing it or adding a country", () => {
		const row = saved("deny", "US", "FR");
		const refused = "error.access.country-no-database";
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "allow" }, row, off)),
			refused,
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_countries: countries("US", "CA") }, row, off)),
			refused,
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "deny", npmpro_countries: countries("DE") }, null, off)),
			refused,
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_countries: countries("US") }, row, off)),
			null,
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "off" }, row, off)),
			null,
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "deny" }, row, off)),
			null,
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "off", npmpro_countries: [] }, null, off)),
			null,
		);
		assert.equal(
			keyOf(() => assertCountryRules({ npmpro_geo_mode: "allow", npmpro_countries: countries("DE") }, null, on)),
			null,
		);
	});
});
