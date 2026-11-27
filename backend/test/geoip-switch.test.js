import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// A provider switch of /settings/geoip while a download runs (the rest of the settings API is in api-monitoring).

const GEOIP = "/settings/geoip";
const MAXMIND = "https://download.maxmind.com";
const COUNTRY_DOWNLOAD = "/geoip/databases/GeoLite2-Country/download?suffix=tar.gz";
const KEY = "maxmind-license-SECRET-4711";

let api;
let admin;
let geoip;
let internalMonitoringSetting;

const storedMeta = async () => {
	const row = await api.db("setting").where({ id: "geoip" }).first();
	return row ? (typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta) : null;
};
const waitFor = async (check, what) => {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		const value = await check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`timed out waiting for ${what}`);
};
const marker = () => readFile(path.join(api.root, "data/goaccess/geoip/provider"), "utf8").catch(() => null);

before(async () => {
	api = await startApi();
	admin = await api.admin();
	// the backend modules read their paths when first imported, so only after startApi
	({ geoip } = await import("../lib/geoip/instance.js"));
	internalMonitoringSetting = (await import("../internal/monitoring-setting.js")).default;
});
after(() => api?.stop());

it("a switch while a run of the old provider is in progress: readers, marker and last_error follow, the old result is dropped", async () => {
	const original = internalMonitoringSetting.recordGeoipResult;
	const seen = [];
	internalMonitoringSetting.recordGeoipResult = async (result) => {
		await original(result);
		seen.push({ provider: result.provider, stored: (await storedMeta()).last_error });
	};
	try {
		await switchWhileRunning();
	} finally {
		internalMonitoringSetting.recordGeoipResult = original;
	}
	// the run of the old provider ended with its 401, which was never stored
	assert.equal(seen.length, 2, JSON.stringify(seen));
	assert.deepEqual(
		seen.map((entry) => entry.provider),
		["maxmind", "dbip"],
	);
	assert.equal(seen[0].stored, null);
	assert.equal(seen[1].stored, null);
});

const switchWhileRunning = async () => {
	api.outside.http.get(MAXMIND).intercept({ path: COUNTRY_DOWNLOAD, method: "GET" }).reply(401, "no").delay(300);
	const saved = await admin.put(GEOIP, {
		provider: "maxmind",
		account_id: "42",
		license_key: KEY,
		editions: ["GeoLite2-Country"],
	});
	assert.equal(saved.status, 200, saved.text);
	assert.equal(geoip.provider(), "maxmind");
	// the run started by the save is now waiting for the delayed answer
	const switched = await admin.put(GEOIP, { provider: "dbip", dbip_editions: [] });
	assert.equal(switched.status, 200, switched.text);
	assert.equal(switched.body.provider, "dbip");
	assert.equal(switched.body.last_error, null);
	assert.equal(geoip.provider(), "dbip");
	assert.equal(await marker(), "dbip\n");
	// the old run ends with its 401 and the queued run (DB-IP, no editions) after it: the 401 is never stored
	await waitFor(async () => (await storedMeta()).last_check, "the queued run");
	await new Promise((resolve) => setTimeout(resolve, 400));
	assert.equal((await storedMeta()).last_error, null);
	assert.equal((await admin.get(GEOIP)).body.last_error, null);
	assert.equal(geoip.provider(), "dbip");
};

it("drops the result of a run of a provider that is no longer the effective one", async () => {
	const before_ = await storedMeta();
	await internalMonitoringSetting.recordGeoipResult({ ok: false, error: "stale", updated: [], provider: "maxmind" });
	assert.deepEqual(await storedMeta(), before_);
	await internalMonitoringSetting.recordGeoipResult({ ok: false, error: "current", updated: [], provider: "dbip" });
	assert.equal((await storedMeta()).last_error, "current");
});

it("a save that leaves the effective provider alone keeps the last error", async () => {
	const done = await admin.put(GEOIP, { dbip_editions: [] });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.last_error, "current");
});

it("a failing swap of the readers does not fail the save, and the download still starts", async () => {
	const original = geoip.reload;
	geoip.reload = () => Promise.reject(new Error("reload broke"));
	try {
		// maxmind without credentials: the hook's run records the missing credentials, proving it started
		const done = await admin.put(GEOIP, { provider: "maxmind", account_id: "", license_key: "", editions: [] });
		assert.equal(done.status, 200, done.text);
		assert.equal(done.body.provider, "maxmind");
		assert.equal((await storedMeta()).provider, "maxmind");
		await waitFor(async () => (await storedMeta()).last_error, "the download after the switch");
	} finally {
		geoip.reload = original;
	}
	assert.match((await storedMeta()).last_error, /MaxMind account ID and license key are required/u);
});
