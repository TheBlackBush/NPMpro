import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { PRIVATE_RANGES, renderGeoipConf, renderGeoipLists } from "../lib/geoip/nginx-conf.js";

const VARIANT_ERROR = /variant/u;
const ID_ERROR = /id/u;

const list = (id, mode, unknown, countries) => ({
	id,
	npmpro_geo_mode: mode,
	npmpro_geo_unknown: unknown,
	countries,
});

describe("renderGeoipConf", () => {
	it("writes the database variant", () => {
		assert.equal(
			renderGeoipConf({ variant: "database", file: "/data/goaccess/geoip/dbip-country-lite.mmdb" }),
			"# GeoIP country database of the active provider (Settings, GeoIP), written by NPMpro\ngeoip_country /data/goaccess/geoip/dbip-country-lite.mmdb;\ngeo $npmpro_geo_db {\n  default 1;\n}\n",
		);
	});

	it("writes the custom variant", () => {
		assert.equal(
			renderGeoipConf({ variant: "custom" }),
			"# geoip_country comes from /data/custom_nginx (your own directive wins, Settings, GeoIP)\ngeo $npmpro_geo_db {\n  default 1;\n}\n",
		);
	});

	it("writes the off variant", () => {
		assert.equal(
			renderGeoipConf({ variant: "off" }),
			"# no usable GeoIP country database: country rules of access lists let every visitor pass (Settings, GeoIP)\ngeo $npmpro_geo_db {\n  default 0;\n}\n",
		);
	});

	it("refuses an unknown variant", () => {
		assert.throws(() => renderGeoipConf({ variant: "databse" }), VARIANT_ERROR);
		assert.throws(() => renderGeoipConf({}), VARIANT_ERROR);
	});

	it("refuses a path with a character outside the safe set", () => {
		assert.throws(() => renderGeoipConf({ variant: "database", file: "/data/a b.mmdb" }));
		assert.throws(() => renderGeoipConf({ variant: "database", file: "/data/a;b.mmdb" }));
		assert.throws(() => renderGeoipConf({ variant: "database" }));
	});
});

describe("first-start files", () => {
	const heredoc = async (name) => {
		const script = await readFile(
			path.join(import.meta.dirname, "../../rootfs/usr/local/bin/data-setup.sh"),
			"utf8",
		);
		const start = `> /data/npmpro/nginx/${name} <<'EOF'\n`;
		const from = script.indexOf(start);
		const to = script.indexOf("\nEOF\n", from);
		if (from < 0 || to < 0) throw new Error(`${name} heredoc not found`);
		return `${script.slice(from + start.length, to)}\n`;
	};

	it("data-setup.sh writes what the renderers write", async () => {
		assert.equal(await heredoc("geoip-lists.conf"), renderGeoipLists([]));
		assert.equal(await heredoc("geoip.conf"), renderGeoipConf({ variant: "off" }));
	});
});

describe("renderGeoipLists", () => {
	it("refuses a list id that is not a positive integer", () => {
		for (const id of ["1\nx", "a", 0, -1, 1.5, undefined]) {
			assert.throws(() => renderGeoipLists([list(id, "allow", "auto", [])]), ID_ERROR);
		}
	});

	const privateGeo = `geo $npmpro_geo_private {\n  default 0;\n${PRIVATE_RANGES.map((r) => `  ${r} 1;\n`).join("")}}\n`;

	it("holds only the private geo without lists", () => {
		const text = renderGeoipLists([]);
		assert.ok(text.endsWith(privateGeo));
		assert.ok(text.startsWith("#"));
		assert.equal(text.includes("map "), false);
	});

	it("writes an allow list with unknown auto as blocked", () => {
		const text = renderGeoipLists([list(3, "allow", "auto", ["DE", "FR"])]);
		assert.ok(
			text.endsWith(
				`${privateGeo}\n# access list 3: allow only these countries, unknown blocked\nmap "$npmpro_geo_db:$npmpro_geo_private:$geoip_country_code" $npmpro_geo_3 {\n  default 0;\n  "~^0:" 1;\n  "~^1:1:" 1;\n  "1:0:" 0;\n  "1:0:DE" 1;\n  "1:0:FR" 1;\n}\n`,
			),
		);
	});

	it("lets unknown pass on an allow list with pass", () => {
		const text = renderGeoipLists([list(1, "allow", "pass", ["DE"])]);
		assert.ok(text.includes("unknown passes"));
		assert.ok(text.includes('  "1:0:" 1;'));
	});

	it("writes a deny list with unknown auto as passing", () => {
		const text = renderGeoipLists([list(2, "deny", "auto", ["RU"])]);
		assert.ok(text.includes("# access list 2: block these countries, unknown passes"));
		assert.ok(text.includes("  default 1;"));
		assert.ok(text.includes('  "1:0:" 1;'));
		assert.ok(text.includes('  "1:0:RU" 0;'));
	});

	it("blocks unknown on a deny list with block", () => {
		const text = renderGeoipLists([list(2, "deny", "block", ["RU"])]);
		assert.ok(text.includes("block these countries, unknown blocked"));
		assert.ok(text.includes('  "1:0:" 0;'));
	});

	it("leaves out a list with mode off", () => {
		const text = renderGeoipLists([list(1, "off", "auto", ["DE"]), list(2, "allow", "auto", ["DE"])]);
		assert.equal(text.includes("npmpro_geo_1 "), false);
		assert.ok(text.includes("$npmpro_geo_2 {"));
	});

	it("deduplicates and sorts countries and skips invalid codes", () => {
		const text = renderGeoipLists([list(1, "allow", "auto", ["FR", "DE", "FR", "de", "XYZ", "AT"])]);
		const codes = [...text.matchAll(/"1:0:(?<code>[A-Za-z]+)" 1;/gu)].map((m) => m.groups.code);
		assert.deepEqual(codes, ["AT", "DE", "FR"]);
	});

	it("writes the lists in id order", () => {
		const text = renderGeoipLists([list(10, "allow", "auto", []), list(2, "deny", "auto", [])]);
		assert.ok(text.indexOf("$npmpro_geo_2 {") < text.indexOf("$npmpro_geo_10 {"));
	});
});
