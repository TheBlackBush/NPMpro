import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { startApi } from "./support/api.js";
import { withDatabaseType } from "./support/mmdb.js";

let api;
let geoipStatus;
let fixture;
const saved = process.env.GEOIP_PROVIDER;

const dir = () => path.join(api.root, "data/goaccess/geoip");
const customFile = () => path.join(api.root, "data/custom_nginx/http.conf");

before(async () => {
	api = await startApi();
	({ geoipStatus } = await import("../internal/geoip-nginx.js"));
	fixture = await readFile(path.join(import.meta.dirname, "fixtures", "GeoLite2-Country-Test.mmdb"));
	await mkdir(dir(), { recursive: true });
	await mkdir(path.dirname(customFile()), { recursive: true });
});
afterEach(async () => {
	if (saved === undefined) delete process.env.GEOIP_PROVIDER;
	else process.env.GEOIP_PROVIDER = saved;
	await rm(customFile(), { force: true });
	await rm(path.join(dir(), "dbip-country-lite.mmdb"), { force: true });
	await rm(path.join(dir(), "GeoLite2-Country.mmdb"), { force: true });
});
after(() => api?.stop());

describe("geoipStatus", () => {
	it("uses DB-IP when nothing is set and the file is usable", async () => {
		delete process.env.GEOIP_PROVIDER;
		await writeFile(path.join(dir(), "dbip-country-lite.mmdb"), withDatabaseType(fixture, "DBIP-Country-Lite"));
		const status = await geoipStatus();
		assert.equal(status.provider, "dbip");
		assert.equal(status.file, path.join(dir(), "dbip-country-lite.mmdb"));
		assert.equal(status.variant, "database");
		assert.equal(status.available, true);
		assert.equal(status.custom_directive, false);
	});

	it("is off without a database", async () => {
		delete process.env.GEOIP_PROVIDER;
		const status = await geoipStatus();
		assert.equal(status.variant, "off");
		assert.equal(status.available, false);
	});

	it("follows GEOIP_PROVIDER=maxmind with nothing stored", async () => {
		process.env.GEOIP_PROVIDER = "maxmind";
		await writeFile(path.join(dir(), "GeoLite2-Country.mmdb"), fixture);
		const status = await geoipStatus();
		assert.equal(status.provider, "maxmind");
		assert.equal(status.file, path.join(dir(), "GeoLite2-Country.mmdb"));
		assert.equal(status.variant, "database");
	});

	it("is custom when a custom geoip_country directive exists", async () => {
		delete process.env.GEOIP_PROVIDER;
		await writeFile(customFile(), "geoip_country /x/own.mmdb;\n");
		const status = await geoipStatus();
		assert.equal(status.custom_directive, true);
		assert.equal(status.variant, "custom");
		assert.equal(status.available, true);
	});
});
