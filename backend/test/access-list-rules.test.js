import assert from "node:assert/strict";
import { it } from "node:test";
import { assertAccessListRules, clientsWithAddress } from "../lib/access-list-rules.js";

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
