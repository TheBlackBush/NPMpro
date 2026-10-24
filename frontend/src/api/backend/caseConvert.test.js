import assert from "node:assert/strict";
import { it } from "node:test";
import { camelizeKeys, decamelizeKeys } from "./caseConvert.js";

it("camelizes nested keys", () => {
	assert.deepEqual(camelizeKeys({ top_ips: [{ last_seen: 1 }] }), { topIps: [{ lastSeen: 1 }] });
});

it("does not throw on keys ending in a separator", () => {
	assert.deepEqual(camelizeKeys({ "--": 1, a_: 2 }), { "": 1, a: 2 });
});

it("decamelizes keys", () => {
	assert.deepEqual(decamelizeKeys({ topIps: 1 }), { top_ips: 1 });
});
