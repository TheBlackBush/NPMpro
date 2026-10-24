import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import * as tar from "tar";
import { createGeoip } from "../lib/geoip/lookup.js";
import { runConfiguredGeoipUpdate } from "../lib/geoip/run.js";
import { updateGeoip } from "../lib/geoip/update.js";

const fixtures = path.join(import.meta.dirname, "fixtures");
const COUNTRY = "GeoLite2-Country.mmdb";
const ASN = "GeoLite2-ASN.mmdb";
const KEY = "secret-license-key-123";

const tempDir = () => mkdtemp(path.join(tmpdir(), "geoip-"));

const withFixtures = async () => {
	const dir = await tempDir();
	await copyFile(path.join(fixtures, "GeoLite2-Country-Test.mmdb"), path.join(dir, COUNTRY));
	await copyFile(path.join(fixtures, "GeoLite2-ASN-Test.mmdb"), path.join(dir, ASN));
	return dir;
};

/** Builds a MaxMind style tar.gz (dated folder) holding the given file content as GeoLite2-Country.mmdb */
const buildArchive = async (content) => {
	const root = await tempDir();
	const folder = path.join(root, "GeoLite2-Country_20261020");
	await mkdir(folder);
	await writeFile(path.join(folder, COUNTRY), content);
	const file = path.join(root, "out.tar.gz");
	await tar.c({ gzip: true, cwd: root, file }, ["GeoLite2-Country_20261020"]);
	return readFile(file);
};

const stubFetch = (body, status = 200) => {
	const calls = [];
	const fn = async (url, init) => {
		calls.push({ url, init });
		return new Response(status === 200 ? body : "denied", { status });
	};
	fn.calls = calls;
	return fn;
};

describe("createGeoip", () => {
	it("resolves country and ASN from the MaxMind test databases", async () => {
		const geoip = createGeoip({ dir: await withFixtures() });
		await geoip.reload();
		assert.deepEqual(geoip.available(), { country: true, asn: true });
		assert.equal(geoip.lookup("2.125.160.216").country, "GB");
		assert.deepEqual(geoip.lookup("1.0.0.1"), { country: null, asn: 15169, asnName: "Google Inc." });
	});

	it("returns nulls for a private IP and null for garbage", async () => {
		const geoip = createGeoip({ dir: await withFixtures() });
		await geoip.reload();
		assert.deepEqual(geoip.lookup("192.168.1.10"), { country: null, asn: null, asnName: null });
		assert.equal(geoip.lookup("not-an-ip"), null);
	});

	it("reports nothing available without files", async () => {
		const geoip = createGeoip({ dir: await tempDir() });
		await geoip.reload();
		assert.deepEqual(geoip.available(), { country: false, asn: false });
		assert.deepEqual(geoip.lookup("2.125.160.216"), { country: null, asn: null, asnName: null });
	});

	it("picks up a replaced file on reload and keeps the old reader for a corrupt one", async () => {
		const dir = await tempDir();
		await copyFile(path.join(fixtures, "GeoLite2-ASN-Test.mmdb"), path.join(dir, COUNTRY));
		const geoip = createGeoip({ dir });
		await geoip.reload();
		assert.equal(geoip.lookup("2.125.160.216").country, null);
		await copyFile(path.join(fixtures, "GeoLite2-Country-Test.mmdb"), path.join(dir, COUNTRY));
		await geoip.reload();
		assert.equal(geoip.lookup("2.125.160.216").country, "GB");
		await writeFile(path.join(dir, COUNTRY), "garbage");
		await geoip.reload();
		assert.equal(geoip.lookup("2.125.160.216").country, "GB");
	});
});

describe("updateGeoip", () => {
	const fixture = path.join(fixtures, "GeoLite2-Country-Test.mmdb");

	it("downloads with basic auth and replaces the file", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, COUNTRY), "old");
		const fetch = stubFetch(await buildArchive(await readFile(fixture)));
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-Country"],
			dir,
			fetch,
		});
		assert.deepEqual(result, { ok: true, updated: ["GeoLite2-Country"] });
		assert.deepEqual(await readFile(path.join(dir, COUNTRY)), await readFile(fixture));
		assert.equal(
			fetch.calls[0].url,
			"https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz",
		);
		assert.equal(fetch.calls[0].init.headers.Authorization, `Basic ${Buffer.from(`42:${KEY}`).toString("base64")}`);
		assert.equal(fetch.calls[0].init.redirect, "follow");
		assert.deepEqual(await readdir(dir), [COUNTRY]);
	});

	it("keeps the old file on 401 and never leaks the key", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, COUNTRY), "old");
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-Country"],
			dir,
			fetch: stubFetch("", 401),
		});
		assert.equal(result.ok, false);
		assert.match(result.error, /401/u);
		assert.ok(!JSON.stringify(result).includes(KEY));
		assert.ok(!JSON.stringify(result).includes(Buffer.from(`42:${KEY}`).toString("base64")));
		assert.equal(await readFile(path.join(dir, COUNTRY), "utf8"), "old");
	});

	it("keeps the old file when the archive holds a corrupt database", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, COUNTRY), "old");
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-Country"],
			dir,
			fetch: stubFetch(await buildArchive("not a database")),
		});
		assert.equal(result.ok, false);
		assert.equal(await readFile(path.join(dir, COUNTRY), "utf8"), "old");
		assert.deepEqual(await readdir(dir), [COUNTRY]);
	});

	it("scrubs the key from network errors", async () => {
		const dir = await tempDir();
		const fetch = async () => {
			throw new Error(`boom ${KEY}`);
		};
		const result = await updateGeoip({ accountId: "42", licenseKey: KEY, editions: ["GeoLite2-ASN"], dir, fetch });
		assert.equal(result.ok, false);
		assert.ok(!result.error.includes(KEY));
	});
});

describe("runConfiguredGeoipUpdate", () => {
	const make = (values, result) => {
		const events = [];
		return {
			events,
			args: {
				geoip: { reload: async () => events.push("reload") },
				dir: "/x",
				recordResult: async (r) => events.push(["record", r.ok]),
				getConfig: async () => ({ values }),
				update: async (opts) => {
					events.push(["update", opts.accountId, opts.licenseKey, opts.editions, opts.dir]);
					return result;
				},
			},
		};
	};

	it("refuses without credentials and does not fetch", async () => {
		const { args, events } = make({ account_id: "", license_key: "k", editions: [] }, { ok: true, updated: [] });
		const result = await runConfiguredGeoipUpdate(args);
		assert.deepEqual(result, { ok: false, updated: [], error: "MaxMind account ID and license key are required" });
		assert.deepEqual(events, []);
	});

	it("updates, records and reloads on success", async () => {
		const { args, events } = make(
			{ account_id: "1", license_key: "k", editions: ["GeoLite2-ASN"] },
			{ ok: true, updated: ["GeoLite2-ASN"] },
		);
		const result = await runConfiguredGeoipUpdate(args);
		assert.equal(result.ok, true);
		assert.deepEqual(events, [["update", "1", "k", ["GeoLite2-ASN"], "/x"], ["record", true], "reload"]);
	});

	it("records a failure without reloading", async () => {
		const { args, events } = make(
			{ account_id: "1", license_key: "k", editions: ["GeoLite2-ASN"] },
			{ ok: false, updated: [], error: "nope" },
		);
		const result = await runConfiguredGeoipUpdate(args);
		assert.equal(result.error, "nope");
		assert.deepEqual(events.slice(1), [["record", false]]);
	});
});
