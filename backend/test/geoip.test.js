import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { c as createArchive } from "tar";
import { createGeoip } from "../lib/geoip/lookup.js";
import { PROVIDER_MARKER, writeProviderMarker } from "../lib/geoip/marker.js";
import { createGuardedFetch, guardedFetch, runConfiguredGeoipUpdate } from "../lib/geoip/run.js";
import { archiveFilter, updateGeoip } from "../lib/geoip/update.js";
import { withDatabaseType } from "./support/mmdb.js";

const fixtures = path.join(import.meta.dirname, "fixtures");
const COUNTRY = "GeoLite2-Country.mmdb";
const ASN = "GeoLite2-ASN.mmdb";
const HTTP_401 = /HTTP 401/u;
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
	await createArchive({ gzip: true, cwd: root, file }, ["GeoLite2-Country_20261020"]);
	return readFile(file);
};

const stubFetch = (body, status = 200) => {
	const calls = [];
	const fn = (url, init) => {
		calls.push({ url, init });
		return Promise.resolve(new Response(status === 200 ? body : "denied", { status }));
	};
	fn.calls = calls;
	return fn;
};

describe("createGeoip", () => {
	it("resolves country and ASN from the MaxMind test databases", async () => {
		const geoip = createGeoip({ dir: await withFixtures(), provider: "maxmind" });
		await geoip.reload();
		assert.deepEqual(geoip.available(), { country: true, asn: true });
		assert.equal(geoip.lookup("2.125.160.216").country, "GB");
		assert.equal(geoip.lookup("2001:218::").country, "JP");
		assert.deepEqual(geoip.lookup("1.0.0.1"), { country: null, asn: 15169, asnName: "Google Inc." });
	});

	it("returns nulls for a private IP and null for garbage", async () => {
		const geoip = createGeoip({ dir: await withFixtures(), provider: "maxmind" });
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
		const geoip = createGeoip({ dir, provider: "maxmind" });
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
		assert.match(result.error, HTTP_401);
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
		const fetch = () => Promise.reject(new Error(`boom ${KEY}`));
		const result = await updateGeoip({ accountId: "42", licenseKey: KEY, editions: ["GeoLite2-ASN"], dir, fetch });
		assert.equal(result.ok, false);
		assert.ok(!result.error.includes(KEY));
		assert.equal(result.error, "GeoLite2-ASN: Download failed (network error)");
	});

	it("reports a timeout with a fixed message", async () => {
		const fetch = () => Promise.reject(new DOMException("x", "TimeoutError"));
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-ASN"],
			dir: await tempDir(),
			fetch,
		});
		assert.equal(result.error, "GeoLite2-ASN: Download timed out");
	});

	it("rejects an oversized download by content-length", async () => {
		const fetch = () =>
			Promise.resolve(
				new Response("x", { status: 200, headers: { "content-length": String(400 * 1024 * 1024) } }),
			);
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-ASN"],
			dir: await tempDir(),
			fetch,
		});
		assert.equal(result.error, "GeoLite2-ASN: The download is too large");
	});

	it("reports an unreadable archive", async () => {
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-ASN"],
			dir: await tempDir(),
			fetch: stubFetch("this is not a tar.gz"),
		});
		assert.equal(result.error, "GeoLite2-ASN: The downloaded archive could not be read");
	});

	it("extracts only directories and regular .mmdb/.txt files", () => {
		assert.equal(archiveFilter("x/", { type: "Directory", size: 0 }), true);
		assert.equal(archiveFilter("x/GeoLite2-Country.mmdb", { type: "File", size: 10 }), true);
		assert.equal(archiveFilter("x/LICENSE.txt", { type: "File", size: 10 }), true);
		assert.equal(archiveFilter("x/run.sh", { type: "File", size: 10 }), false);
		assert.equal(archiveFilter("x/x.mmdb", { type: "SymbolicLink", size: 0 }), false);
		assert.equal(archiveFilter("x/x.mmdb", { type: "Link", size: 0 }), false);
		assert.equal(archiveFilter("x/x.mmdb", { type: "File", size: 301 * 1024 * 1024 }), false);
	});

	it("rejects a symlink entry named like the database", async () => {
		const root = await tempDir();
		const folder = path.join(root, "GeoLite2-Country_20261020");
		await mkdir(folder);
		await copyFile(fixture, path.join(folder, "real.bin"));
		await symlink("real.bin", path.join(folder, COUNTRY));
		const file = path.join(root, "out.tar.gz");
		await createArchive({ gzip: true, cwd: root, file }, ["GeoLite2-Country_20261020"]);
		const dir = await tempDir();
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-Country"],
			dir,
			fetch: stubFetch(await readFile(file)),
		});
		assert.equal(result.error, `GeoLite2-Country: The archive does not contain ${COUNTRY}`);
		assert.deepEqual(await readdir(dir), []);
	});

	it("rejects a database of the wrong edition", async () => {
		const dir = await tempDir();
		// an ASN database delivered as the Country edition
		const result = await updateGeoip({
			accountId: "42",
			licenseKey: KEY,
			editions: ["GeoLite2-Country"],
			dir,
			fetch: stubFetch(await buildArchive(await readFile(path.join(fixtures, "GeoLite2-ASN-Test.mmdb")))),
		});
		assert.equal(result.error, "GeoLite2-Country: The downloaded database is invalid");
		assert.deepEqual(await readdir(dir), []);
	});

	it("removes leftover work dirs from interrupted updates", async () => {
		const dir = await tempDir();
		await mkdir(path.join(dir, ".update-old"));
		await writeFile(path.join(dir, ".update-old", "x"), "x");
		await updateGeoip({ accountId: "1", licenseKey: KEY, editions: [], dir, fetch: stubFetch("") });
		assert.deepEqual(await readdir(dir), []);
	});

	it("replaces what succeeded and reports the failed edition", async () => {
		const dir = await tempDir();
		const archive = await buildArchive(await readFile(fixture));
		let n = 0;
		const fetch = () => Promise.resolve(n++ === 0 ? new Response(archive) : new Response("no", { status: 401 }));
		const result = await updateGeoip({
			accountId: "1",
			licenseKey: KEY,
			editions: ["GeoLite2-Country", "GeoLite2-ASN"],
			dir,
			fetch,
		});
		assert.equal(result.ok, false);
		assert.deepEqual(result.updated, ["GeoLite2-Country"]);
		assert.equal(result.error, "GeoLite2-ASN: MaxMind returned HTTP 401");
	});
});

describe("runConfiguredGeoipUpdate", () => {
	const MAXMIND = { provider: "maxmind", account_id: "1", license_key: "k", editions: ["GeoLite2-ASN"] };
	const DBIP = { provider: "dbip", dbip_editions: ["Country", "ASN"] };

	const make = (values, result) => {
		const events = [];
		return {
			events,
			args: {
				geoip: { reload: async () => events.push("reload") },
				dir: "/x",
				recordResult: (r) => {
					events.push(["record", r.ok, r.provider]);
					return Promise.resolve();
				},
				getConfig: async () => ({ values }),
				updaters: {
					maxmind: (opts) => {
						events.push(["maxmind", opts.accountId, opts.licenseKey, opts.editions, opts.dir]);
						return Promise.resolve(result);
					},
					dbip: (opts) => {
						events.push(["dbip", opts.editions, opts.dir, "accountId" in opts]);
						return Promise.resolve(result);
					},
				},
			},
		};
	};

	it("MaxMind refuses without credentials and does not fetch", async () => {
		const { args, events } = make({ ...MAXMIND, account_id: "" }, { ok: true, updated: [] });
		const result = await runConfiguredGeoipUpdate(args);
		assert.deepEqual(result, {
			ok: false,
			updated: [],
			error: "MaxMind account ID and license key are required",
			provider: "maxmind",
		});
		assert.deepEqual(events, []);
	});

	it("DB-IP needs no credentials and calls the DB-IP updater", async () => {
		const { args, events } = make(DBIP, { ok: true, updated: ["Country"] });
		const result = await runConfiguredGeoipUpdate(args);
		assert.deepEqual(result, { ok: true, updated: ["Country"], provider: "dbip" });
		assert.deepEqual(events, [["dbip", ["Country", "ASN"], "/x", false], ["record", true, "dbip"], "reload"]);
	});

	it("downloads, records and reloads nothing without selected databases", async () => {
		for (const values of [
			{ ...MAXMIND, editions: [] },
			{ ...DBIP, dbip_editions: [] },
		]) {
			const { args, events } = make(values, { ok: false, updated: [] });
			const result = await runConfiguredGeoipUpdate(args);
			assert.deepEqual(result, { ok: true, updated: [], provider: values.provider });
			assert.deepEqual(events, []);
		}
	});

	it("updates, records with the provider and reloads on success", async () => {
		const { args, events } = make(MAXMIND, { ok: true, updated: ["GeoLite2-ASN"] });
		const result = await runConfiguredGeoipUpdate(args);
		assert.equal(result.ok, true);
		assert.equal(result.provider, "maxmind");
		assert.deepEqual(events, [
			["maxmind", "1", "k", ["GeoLite2-ASN"], "/x"],
			["record", true, "maxmind"],
			"reload",
		]);
	});

	it("reloads and records when only some editions were replaced", async () => {
		const { args, events } = make(
			{ ...MAXMIND, editions: ["GeoLite2-Country", "GeoLite2-ASN"] },
			{ ok: false, updated: ["GeoLite2-Country"], error: "GeoLite2-ASN: MaxMind returned HTTP 401" },
		);
		let recorded;
		args.recordResult = (r) => {
			recorded = r;
			return Promise.resolve();
		};
		const result = await runConfiguredGeoipUpdate(args);
		assert.equal(result.ok, false);
		assert.deepEqual(recorded.updated, ["GeoLite2-Country"]);
		assert.deepEqual(events.slice(1), ["reload"]);
	});

	it("queues one follow-up run that reads the configuration again, after a switch it uses the new provider", async () => {
		const { args, events } = make(MAXMIND, null);
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		let config = MAXMIND;
		let running = 0;
		let overlap = false;
		const slow = (name) => async () => {
			running++;
			overlap ||= running > 1;
			events.push(["fetch", name]);
			await gate;
			running--;
			return { ok: true, updated: [] };
		};
		args.getConfig = () => Promise.resolve({ values: config });
		args.updaters = { maxmind: slow("maxmind"), dbip: slow("dbip") };
		const first = runConfiguredGeoipUpdate(args);
		config = DBIP;
		const second = runConfiguredGeoipUpdate(args);
		const third = runConfiguredGeoipUpdate(args);
		assert.equal(second, third);
		release();
		const [, queuedResult] = await Promise.all([first, second, third]);
		assert.deepEqual(
			events.filter((e) => e[0] === "fetch"),
			[
				["fetch", "maxmind"],
				["fetch", "dbip"],
			],
		);
		assert.equal(queuedResult.provider, "dbip");
		assert.equal(overlap, false);
	});

	it("records a failure without reloading", async () => {
		const { args, events } = make(MAXMIND, { ok: false, updated: [], error: "nope" });
		const result = await runConfiguredGeoipUpdate(args);
		assert.equal(result.error, "nope");
		assert.deepEqual(events.slice(1), [["record", false, "maxmind"]]);
	});

	it("hands the guarded fetch to each provider's updater, never the global fetch", async () => {
		const seen = {};
		const { args } = make(MAXMIND, null);
		let config = MAXMIND;
		args.getConfig = () => Promise.resolve({ values: config });
		args.updaters = {
			maxmind: (opts) => {
				seen.maxmind = opts.fetch;
				return Promise.resolve({ ok: true, updated: [] });
			},
			dbip: (opts) => {
				seen.dbip = opts.fetch;
				return Promise.resolve({ ok: true, updated: [] });
			},
		};
		await runConfiguredGeoipUpdate(args);
		config = DBIP;
		await runConfiguredGeoipUpdate(args);
		assert.equal(seen.maxmind, guardedFetch);
		assert.equal(seen.dbip, guardedFetch);
		assert.notEqual(guardedFetch, globalThis.fetch);
	});
});

describe("createGuardedFetch", () => {
	it("sends every request through the guarded agent", async () => {
		const agent = {};
		const calls = [];
		const fetchFn = (url, init) => {
			calls.push({ url, init });
			return Promise.resolve("response");
		};
		const guarded = createGuardedFetch({ fetchFn, agent, mocked: () => false });
		assert.equal(await guarded("https://example.test/x", { method: "HEAD" }), "response");
		assert.equal(calls[0].init.dispatcher, agent);
		assert.equal(calls[0].init.method, "HEAD");
		await guarded("https://example.test/y");
		assert.equal(calls[1].init.dispatcher, agent);
	});

	it("reads through the global dispatcher when the tests mock the outbound", async () => {
		const calls = [];
		const guarded = createGuardedFetch({
			fetchFn: (_url, init) => {
				calls.push(init);
				return Promise.resolve(null);
			},
			agent: {},
			mocked: () => true,
		});
		await guarded("https://example.test/x", { method: "GET" });
		assert.deepEqual(calls, [{ method: "GET" }]);
	});
});

describe("createGeoip providers", () => {
	const dbipFixtures = async () => {
		const dir = await tempDir();
		for (const [from, to, type] of [
			["GeoLite2-Country-Test.mmdb", "dbip-country-lite.mmdb", "DBIP-Country-Lite"],
			["GeoLite2-ASN-Test.mmdb", "dbip-asn-lite.mmdb", "DBIP-ASN-Lite"],
		]) {
			await writeFile(path.join(dir, to), withDatabaseType(await readFile(path.join(fixtures, from)), type));
		}
		await copyFile(path.join(fixtures, "GeoLite2-Country-Test.mmdb"), path.join(dir, COUNTRY));
		await copyFile(path.join(fixtures, "GeoLite2-ASN-Test.mmdb"), path.join(dir, ASN));
		return dir;
	};

	it("opens the files of the provider it was switched to, after the next reload", async () => {
		const geoip = createGeoip({ dir: await dbipFixtures(), provider: "maxmind" });
		assert.equal(geoip.provider(), "maxmind");
		await geoip.reload();
		assert.deepEqual(geoip.available(), { country: true, asn: true });
		geoip.setProvider("dbip");
		assert.equal(geoip.provider(), "dbip");
		assert.deepEqual(geoip.available(), { country: false, asn: false });
		assert.equal(geoip.lookup("2.125.160.216").country, null);
		await geoip.reload();
		assert.deepEqual(geoip.available(), { country: true, asn: true });
		assert.equal(geoip.lookup("2.125.160.216").country, "GB");
		geoip.setProvider("maxmind");
		assert.deepEqual(geoip.available(), { country: false, asn: false });
		await geoip.reload();
		assert.deepEqual(geoip.available(), { country: true, asn: true });
	});

	it("starts on DB-IP and keeps the readers when the same provider is set again", async () => {
		const geoip = createGeoip({ dir: await dbipFixtures() });
		assert.equal(geoip.provider(), "dbip");
		await geoip.reload();
		geoip.setProvider("dbip");
		assert.deepEqual(geoip.available(), { country: true, asn: true });
	});

	it("a switch that comes while a reload runs ends on the new provider's files after the next reload", async () => {
		const geoip = createGeoip({ dir: await dbipFixtures(), provider: "maxmind" });
		const loading = geoip.reload();
		await new Promise((resolve) => setImmediate(resolve));
		geoip.setProvider("dbip");
		await loading;
		await geoip.reload();
		assert.deepEqual(geoip.available(), { country: true, asn: true });
		assert.equal(geoip.provider(), "dbip");
	});
});

describe("writeProviderMarker", () => {
	it("writes the id with a newline, leaves no temporary file and creates the folder", async () => {
		const dir = path.join(await tempDir(), "missing", "geoip");
		await writeProviderMarker(dir, "dbip");
		assert.equal(await readFile(path.join(dir, PROVIDER_MARKER), "utf8"), "dbip\n");
		assert.deepEqual(await readdir(dir), ["provider"]);
		assert.ok((await stat(path.join(dir, PROVIDER_MARKER))).mode.toString(8).endsWith("644"));
		await writeProviderMarker(dir, "maxmind");
		assert.equal(await readFile(path.join(dir, PROVIDER_MARKER), "utf8"), "maxmind\n");
		assert.deepEqual(await readdir(dir), ["provider"]);
	});
});
