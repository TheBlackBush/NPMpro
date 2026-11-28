import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import maxmind from "maxmind";
import { countryDatabase, hasCustomDirective } from "../lib/geoip/usable.js";
import { withDatabaseType } from "./support/mmdb.js";

const fixture = () => readFile(path.join(import.meta.dirname, "fixtures", "GeoLite2-Country-Test.mmdb"));
const tempDir = () => mkdtemp(path.join(tmpdir(), "geoip-usable-"));

describe("countryDatabase", () => {
	it("is not usable without a file", async () => {
		const dir = await tempDir();
		const result = await countryDatabase({ dir, provider: "dbip" });
		assert.equal(result.usable, false);
		assert.equal(result.file, path.join(dir, "dbip-country-lite.mmdb"));
	});

	it("is usable for a DB-IP file of the DB-IP type", async () => {
		const dir = await tempDir();
		await writeFile(
			path.join(dir, "dbip-country-lite.mmdb"),
			withDatabaseType(await fixture(), "DBIP-Country-Lite"),
		);
		assert.equal((await countryDatabase({ dir, provider: "dbip" })).usable, true);
	});

	it("is usable for the MaxMind file with the maxmind provider", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, "GeoLite2-Country.mmdb"), await fixture());
		const result = await countryDatabase({ dir, provider: "maxmind" });
		assert.equal(result.usable, true);
		assert.equal(result.file, path.join(dir, "GeoLite2-Country.mmdb"));
	});

	it("is not usable when the file has the wrong type", async () => {
		const dir = await tempDir();
		await writeFile(path.join(dir, "dbip-country-lite.mmdb"), await fixture());
		assert.equal((await countryDatabase({ dir, provider: "dbip" })).usable, false);
	});

	it("is not usable for a truncated file", async () => {
		const dir = await tempDir();
		const bytes = withDatabaseType(await fixture(), "DBIP-Country-Lite");
		await writeFile(path.join(dir, "dbip-country-lite.mmdb"), bytes.subarray(0, 1000));
		assert.equal((await countryDatabase({ dir, provider: "dbip" })).usable, false);
	});

	it("opens a file once while its mtime and size stay, and again after a change", async () => {
		const dir = await tempDir();
		const file = path.join(dir, "dbip-country-lite.mmdb");
		await writeFile(file, withDatabaseType(await fixture(), "DBIP-Country-Lite"));
		let opened = 0;
		const open = (name) => {
			opened++;
			return maxmind.open(name);
		};
		assert.equal((await countryDatabase({ dir, provider: "dbip", open })).usable, true);
		assert.equal((await countryDatabase({ dir, provider: "dbip", open })).usable, true);
		assert.equal(opened, 1);
		const later = new Date(Date.now() + 60000);
		await utimes(file, later, later);
		await countryDatabase({ dir, provider: "dbip", open });
		assert.equal(opened, 2);
	});
});

describe("hasCustomDirective", () => {
	const files = async (...texts) => {
		const dir = await tempDir();
		await mkdir(dir, { recursive: true });
		const names = [];
		for (const [index, text] of texts.entries()) {
			const name = path.join(dir, `f${index}.conf`);
			await writeFile(name, text);
			names.push(name);
		}
		return names;
	};

	it("finds a directive", async () => {
		assert.equal(await hasCustomDirective(await files("geoip_country /x.mmdb;\n")), true);
		assert.equal(await hasCustomDirective(await files("a;\n   geoip_country /x;\n")), true);
	});

	it("ignores comments and other words", async () => {
		assert.equal(await hasCustomDirective(await files("# geoip_country /x;\n")), false);
		assert.equal(await hasCustomDirective(await files("#geoip_country\n")), false);
		assert.equal(await hasCustomDirective(await files("map $geoip_country_code $x {}\n")), false);
		assert.equal(await hasCustomDirective(await files("geoip_country_code\n")), false);
	});

	it("handles CRLF, a hash inside a value and a tab before the directive", async () => {
		assert.equal(await hasCustomDirective(await files("a;\r\ngeoip_country /x.mmdb;\r\n")), true);
		assert.equal(await hasCustomDirective(await files('geoip_country "/x#y.mmdb"; # note\n')), true);
		assert.equal(await hasCustomDirective(await files("\tgeoip_country /x;\n")), true);
		assert.equal(await hasCustomDirective(await files("\t# geoip_country /x;\r\n")), false);
	});

	it("reads every file and ignores a missing one", async () => {
		const [one, two] = await files("a;\n", "geoip_country /y;\n");
		assert.equal(await hasCustomDirective([one, two]), true);
		assert.equal(await hasCustomDirective(["/nonexistent/a.conf", one]), false);
		assert.equal(await hasCustomDirective(["/nonexistent/a.conf"]), false);
	});
});
