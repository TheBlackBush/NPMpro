import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

let api;

before(async () => {
	api = await startApi({ env: { ACME_EAB_KID: "only-kid", NPMPRO_TEST_OUTBOUND: "mock" } });
});
after(() => api.stop());

it("locks the EAB pair together but reports which value is set", async () => {
	const res = await (await api.admin()).get("/settings/acme");
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.locked, ["eab_kid", "eab_hmac_key"]);
	assert.equal(res.body.eab_kid_set, true);
	assert.equal(res.body.eab_hmac_key_set, false);
	assert.ok(!res.text.includes("only-kid"));
});
