import assert from "node:assert/strict";
import { copyFile, mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import maxmind from "maxmind";
import { dbipUrl, monthOf, previousMonth, updateDbip } from "../lib/geoip/dbip.js";
import { withDatabaseType } from "./support/mmdb.js";

const fixtures = path.join(import.meta.dirname, "fixtures");
const FILE = "dbip-country-lite.mmdb";
const NOW = () => new Date("2026-11-15T12:00:00Z");
const MODIFIED = "Sat, 01 Nov 2026 00:00:00 GMT";
const OLD = new Date("2026-10-01T00:00:00Z");
const URL_NOV = "https://download.db-ip.com/free/dbip-country-lite-2026-11.mmdb.gz";
const URL_OCT = "https://download.db-ip.com/free/dbip-country-lite-2026-10.mmdb.gz";
const NOT_FOUND = "DB-IP has no file for 2026-11 or 2026-10";

const dbipFixture = async (type = "DBIP-Country-Lite") =>
	withDatabaseType(await readFile(path.join(fixtures, "GeoLite2-Country-Test.mmdb")), type);

const tempDir = () => mkdtemp(path.join(tmpdir(), "dbip-"));

/** A dir holding an old file with known content */
const withOldFile = async () => {
	const dir = await tempDir();
	await writeFile(path.join(dir, FILE), "old content");
	await utimes(path.join(dir, FILE), OLD, OLD);
	return dir;
};

/** routes: url -> {head: status, get: status, body, headers}; anything else answers 404 */
const stubFetch = (routes) => {
	const calls = [];
	const fn = (url, init) => {
		calls.push({ url, method: init.method, init });
		const route = routes[url];
		if (!route) return Promise.resolve(new Response(null, { status: 404 }));
		const status = (init.method === "HEAD" ? route.head : route.get) ?? 200;
		const headers = route.headers ?? { "last-modified": MODIFIED };
		const body = init.method === "HEAD" || status !== 200 ? null : route.body;
		return Promise.resolve(new Response(body, { status, headers }));
	};
	fn.calls = calls;
	return fn;
};

const leftovers = async (dir) => (await readdir(dir)).filter((name) => name.startsWith(".update-"));
const content = (dir) => readFile(path.join(dir, FILE), "utf8");

describe("DB-IP URLs and months", () => {
	it("builds the monthly file URLs", () => {
		assert.equal(dbipUrl("Country", "2026-11"), URL_NOV);
		assert.equal(dbipUrl("ASN", "2026-11"), "https://download.db-ip.com/free/dbip-asn-lite-2026-11.mmdb.gz");
	});

	it("computes the month and the previous month in UTC", () => {
		assert.equal(monthOf(new Date("2026-11-30T23:59:59Z")), "2026-11");
		assert.equal(previousMonth("2026-01"), "2025-12");
		assert.equal(previousMonth("2026-11"), "2026-10");
	});

	it("reads the fixture with the rewritten database type", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, FILE), await dbipFixture());
		const reader = await maxmind.open(path.join(dir, FILE));
		assert.equal(reader.metadata.databaseType, "DBIP-Country-Lite");
		assert.equal(reader.get("2.125.160.216").country.iso_code, "GB");
	});
});

describe("updateDbip", () => {
	it("downloads, unpacks and dates the file by last-modified", async () => {
		const dir = await withOldFile();
		const fetch = stubFetch({ [URL_NOV]: { body: gzipSync(await dbipFixture()) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.deepEqual(result, { ok: true, updated: ["Country"] });
		assert.deepEqual(
			fetch.calls.map((c) => c.method),
			["HEAD", "GET"],
		);
		assert.equal(fetch.calls[0].init.headers, undefined);
		const reader = await maxmind.open(path.join(dir, FILE));
		assert.equal(reader.metadata.databaseType, "DBIP-Country-Lite");
		assert.equal((await stat(path.join(dir, FILE))).mtimeMs, Date.parse(MODIFIED));
		assert.deepEqual(await leftovers(dir), []);
	});

	it("uses the previous month when the current one is a 404", async () => {
		const dir = await tempDir();
		const fetch = stubFetch({ [URL_OCT]: { body: gzipSync(await dbipFixture()) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.deepEqual(result, { ok: true, updated: ["Country"] });
		assert.deepEqual(
			fetch.calls.map((c) => `${c.method} ${c.url}`),
			[`HEAD ${URL_NOV}`, `HEAD ${URL_OCT}`, `GET ${URL_OCT}`],
		);
		assert.deepEqual(await leftovers(dir), []);
	});

	it("fails when both months are missing and keeps the old file", async () => {
		const dir = await withOldFile();
		const result = await updateDbip({ editions: ["Country"], dir, fetch: stubFetch({}), now: NOW });
		assert.deepEqual(result, { ok: false, updated: [], error: `Country: ${NOT_FOUND}` });
		assert.equal(await content(dir), "old content");
		assert.deepEqual(await leftovers(dir), []);
	});

	it("reports another HTTP status", async () => {
		const dir = await tempDir();
		const fetch = stubFetch({ [URL_NOV]: { head: 503 } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.equal(result.error, "Country: DB-IP returned HTTP 503");
	});

	it("reports a failed GET", async () => {
		const dir = await tempDir();
		const fetch = stubFetch({ [URL_NOV]: { get: 500 } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.equal(result.error, "Country: DB-IP returned HTTP 500");
		assert.deepEqual(await leftovers(dir), []);
	});

	it("skips the download when the local file is not older than last-modified", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, FILE), "current");
		const newer = new Date("2026-11-05T00:00:00Z");
		await utimes(path.join(dir, FILE), newer, newer);
		const fetch = stubFetch({ [URL_NOV]: { body: gzipSync(await dbipFixture()) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.deepEqual(result, { ok: true, updated: [] });
		assert.deepEqual(
			fetch.calls.map((c) => c.method),
			["HEAD"],
		);
		assert.equal(await content(dir), "current");
	});

	it("downloads when last-modified is missing or unparsable", async () => {
		for (const headers of [{}, { "last-modified": "garbage" }]) {
			const dir = await withOldFile();
			const fetch = stubFetch({ [URL_NOV]: { headers, body: gzipSync(await dbipFixture()) } });
			const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
			assert.deepEqual(result, { ok: true, updated: ["Country"] });
		}
	});

	it("refuses a declared size over the cap", async () => {
		const dir = await withOldFile();
		const headers = { "last-modified": MODIFIED, "content-length": "5000" };
		const fetch = stubFetch({ [URL_NOV]: { headers, body: gzipSync(await dbipFixture()) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW, maxBytes: 1000 });
		assert.equal(result.error, "Country: The download is too large");
		assert.equal(await content(dir), "old content");
		assert.deepEqual(await leftovers(dir), []);
	});

	it("refuses a packed body over the cap without a declared size", async () => {
		const dir = await withOldFile();
		const fetch = stubFetch({ [URL_NOV]: { body: gzipSync(await dbipFixture()) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW, maxBytes: 100 });
		assert.equal(result.error, "Country: The download is too large");
		assert.equal(await content(dir), "old content");
	});

	it("fails a gzip bomb with the old file kept", async () => {
		const dir = await withOldFile();
		const fetch = stubFetch({ [URL_NOV]: { body: gzipSync(Buffer.alloc(200000)) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW, maxBytes: 100000 });
		assert.equal(result.error, "Country: The unpacked database is too large");
		assert.equal(await content(dir), "old content");
		assert.deepEqual(await leftovers(dir), []);
	});

	it("fails a body that is not gzip", async () => {
		const dir = await withOldFile();
		const fetch = stubFetch({ [URL_NOV]: { body: "not gzip at all" } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.equal(result.error, "Country: The downloaded file could not be unpacked");
		assert.equal(await content(dir), "old content");
	});

	it("refuses a database of another type and keeps the old file", async () => {
		const dir = await withOldFile();
		const maxmindFile = await readFile(path.join(fixtures, "GeoLite2-Country-Test.mmdb"));
		const fetch = stubFetch({ [URL_NOV]: { body: gzipSync(maxmindFile) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.equal(result.error, "Country: The downloaded database is invalid");
		assert.equal(await content(dir), "old content");
		assert.deepEqual(await leftovers(dir), []);
	});

	it("refuses a file that is not an mmdb", async () => {
		const dir = await withOldFile();
		const fetch = stubFetch({ [URL_NOV]: { body: gzipSync(Buffer.from("plain text")) } });
		const result = await updateDbip({ editions: ["Country"], dir, fetch, now: NOW });
		assert.equal(result.error, "Country: The downloaded database is invalid");
	});

	it("maps a timeout and a network error to fixed messages", async () => {
		const dir = await tempDir();
		const abort = () => Promise.reject(Object.assign(new Error("secret detail"), { name: "AbortError" }));
		const timedOut = await updateDbip({ editions: ["Country"], dir, fetch: abort, now: NOW });
		assert.equal(timedOut.error, "Country: Download timed out");
		const broken = () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.1"));
		const failed = await updateDbip({ editions: ["Country"], dir, fetch: broken, now: NOW });
		assert.equal(failed.error, "Country: Download failed (network error)");
		assert.deepEqual(await leftovers(dir), []);
	});

	it("updates the working editions and reports the failing one", async () => {
		const dir = await tempDir();
		await copyFile(path.join(fixtures, "GeoLite2-ASN-Test.mmdb"), path.join(dir, "unused"));
		const fetch = stubFetch({ [URL_NOV]: { body: gzipSync(await dbipFixture()) } });
		const result = await updateDbip({ editions: ["Country", "ASN"], dir, fetch, now: NOW });
		assert.equal(result.ok, false);
		assert.deepEqual(result.updated, ["Country"]);
		assert.equal(result.error, "ASN: DB-IP has no file for 2026-11 or 2026-10");
	});

	it("removes work folders left by an interrupted update", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, ".update-old"), "x");
		await updateDbip({ editions: [], dir, fetch: stubFetch({}), now: NOW });
		assert.deepEqual(await leftovers(dir), []);
	});
});
