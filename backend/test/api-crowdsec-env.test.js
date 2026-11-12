import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// CROWDSEC_* variables win over the row and lock their fields; an invalid one is ignored
const ENV = {
	CROWDSEC_ENABLED: "false",
	CROWDSEC_LAPI_URL: "http://127.0.0.1:9",
	CROWDSEC_API_KEY: "env-key-secret",
	CROWDSEC_APPSEC_URL: "not-a-url",
};

let api;
let admin;
before(async () => {
	api = await startApi({ env: ENV });
	admin = await api.admin();
});
after(() => api?.stop());

const storedMeta = async () => {
	const row = await api.db("setting").where({ id: "crowdsec" }).first();
	return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
};

it("shows the locked fields and the variables, never the key", async () => {
	const res = await admin.get("/settings/crowdsec");
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(res.body.locked, ["enabled", "api_url", "api_key"]);
	assert.deepEqual(res.body.locked_by, {
		enabled: "CROWDSEC_ENABLED",
		api_url: "CROWDSEC_LAPI_URL",
		api_key: "CROWDSEC_API_KEY",
	});
	assert.equal(res.body.api_url, "http://127.0.0.1:9");
	assert.equal(res.body.api_key_set, true);
	assert.equal(res.body.appsec_url, "");
	assert.equal(res.text.includes("env-key-secret"), false);
});

it("ignores locked fields in a save and stores none of them", async () => {
	const res = await admin.put("/settings/crowdsec", {
		enabled: true,
		api_url: "http://other:8080",
		api_key: "typed-key",
		mode: "stream",
	});
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.enabled, false);
	assert.equal(res.body.api_url, "http://127.0.0.1:9");
	assert.equal(res.body.mode, "stream");
	const meta = await storedMeta();
	for (const key of ["enabled", "api_url", "api_key"]) assert.equal(Object.hasOwn(meta, key), false, key);
	const file = await api.read("/data/crowdsec/crowdsec.conf");
	assert.match(file, /^API_KEY=env-key-secret$/mu);
	assert.match(file, /^MODE=stream$/mu);
});
