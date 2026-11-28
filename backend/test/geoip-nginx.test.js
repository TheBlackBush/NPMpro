import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { startApi } from "./support/api.js";
import { reloads } from "./support/hosts.js";
import { withDatabaseType } from "./support/mmdb.js";

const OFF_LINE = /default 0;/u;
const NO_DATABASE = /no GeoIP country database is usable/u;
const FAILS_OPEN = /nginx -t refuses the country database line of geoip.conf/u;
const NO_FALLBACK = /fails because of another file, geoip.conf keeps the country database \(no fallback\)/u;
const DUPLICATE = /"geoip_country" directive is duplicate/u;
const DATABASE_LINE = /^geoip_country \//mu;
const GEOIP_LINE = /geoip_country/u;
const PRIVATE_GEO = /geo \$npmpro_geo_private \{/u;
const OWN_LINE = /^geoip_country/mu;
const DEFAULT_ON = /default 1;/u;
const FR_BLOCKED = / {2}"1:0:FR" 0;/u;
const NAMES_99 = /npmpro_geo_99/u;
const PASSING_99 = /geo \$npmpro_geo_99 \{\n {2}default 1;\n\}/u;

let api;
let geo;
let fixture;
let atStart;
const file = (name) => path.join(api.root, name);
const conf = () => readFile(file("data/npmpro/nginx/geoip.conf"), "utf8");
const lists = () => readFile(file("data/npmpro/nginx/geoip-lists.conf"), "utf8");
const database = () => file("data/goaccess/geoip/dbip-country-lite.mmdb");
const custom = () => file("data/custom_nginx/http.conf");
const nginxTests = async () => (await api.outside.calls()).filter((line) => line === "nginx -tq").length;
const recorder = () => {
	const lines = [];
	const debugLines = [];
	return {
		lines,
		debugLines,
		error: (text) => lines.push(text),
		warn: (text) => lines.push(text),
		info: () => {},
		debug: (text) => debugLines.push(text),
	};
};
const geoipConfFile = () => file("data/npmpro/nginx/geoip.conf");
// nginx refuses NPMpro's geoip_country line while a custom file has one too (in the real include order the error names
// the later file)
const duplicateNginx = () =>
	`#!/bin/sh
if grep -q '^geoip_country' "${geoipConfFile()}" && grep -q 'geoip_country' "${custom()}" 2>/dev/null; then
  echo 'nginx: [emerg] "geoip_country" directive is duplicate in ${custom()}:1' >&2
  echo 'nginx: configuration file /usr/local/nginx/conf/nginx.conf test failed' >&2
  exit 1
fi
exit 0
`;
// a broken host config fails nginx -t whatever geoip.conf holds
const brokenHostNginx = () =>
	`#!/bin/sh
if grep -rlq BADHOST --include='*.conf' "${file("data/nginx/proxy_host")}"; then
  echo 'nginx: [emerg] unexpected "}" in ${file("data/nginx/proxy_host/991.conf")}:1' >&2
  echo 'nginx: configuration file /usr/local/nginx/conf/nginx.conf test failed' >&2
  exit 1
fi
exit 0
`;
const addDatabase = () => writeFile(database(), withDatabaseType(fixture, "DBIP-Country-Lite"));
const state = async () => {
	const row = await api.db("npmpro_notification_state").where({ key: "geoip.failed:geoip" }).first();
	return row ? { state: row.state, data: typeof row.data === "string" ? JSON.parse(row.data) : row.data } : null;
};
const addList = async (mode, countries = ["DE"]) => {
	const [id] = await api.db("access_list").insert({
		name: `geo ${mode}`,
		owner_user_id: 1,
		satisfy_any: 0,
		pass_auth: 0,
		npmpro_geo_mode: mode,
		meta: "{}",
		created_on: new Date(),
		modified_on: new Date(),
	});
	for (const country of countries) {
		await api.db("npmpro_access_list_country").insert({
			access_list_id: id,
			country,
			created_on: new Date(),
			modified_on: new Date(),
		});
	}
	return id;
};
const setLastError = async (error) => {
	const row = await api.db("setting").where({ id: "geoip" }).first();
	const meta = row ? JSON.parse(row.meta) : {};
	if (row)
		await api
			.db("setting")
			.where({ id: "geoip" })
			.update({ meta: JSON.stringify({ ...meta, last_error: error }) });
	else {
		await api.db("setting").insert({
			id: "geoip",
			name: "GeoIP",
			description: "GeoIP",
			value: "geoip",
			meta: JSON.stringify({ last_error: error }),
		});
	}
};

before(async () => {
	api = await startApi();
	atStart = { conf: await conf(), lists: await lists() };
	geo = await import("../internal/geoip-nginx.js");
	fixture = await readFile(path.join(import.meta.dirname, "fixtures", "GeoLite2-Country-Test.mmdb"));
	await mkdir(path.dirname(database()), { recursive: true });
	await mkdir(path.dirname(custom()), { recursive: true });
});
beforeEach(async () => {
	await api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
	await rm(database(), { force: true });
	await rm(custom(), { force: true });
	await api.db("npmpro_access_list_country").delete();
	await api.db("access_list").delete();
	await setLastError(null);
	await geo.syncGeoipConf({ reload: false });
	await geo.writeGeoipLists();
	await api.outside.clearCalls();
});

after(() => api?.stop());

describe("startup", () => {
	it("writes both includes before the first config generation, the off variant without a database", () => {
		// startApi ran prepareApp({ background: false }) in a temporary root without the data-setup.sh files
		assert.match(atStart.conf, OFF_LINE);
		assert.doesNotMatch(atStart.conf, GEOIP_LINE);
		assert.match(atStart.lists, PRIVATE_GEO);
	});

	it("does not leave country rules off when a host config fails nginx -t at start", async () => {
		await addList("allow");
		await addDatabase();
		await api.outside.hookCommand("nginx", brokenHostNginx());
		await writeFile(file("data/nginx/proxy_host/991.conf"), "# BADHOST\n");
		try {
			await geo.startGeoipNginx({ log: recorder() });
			assert.match(await conf(), DATABASE_LINE);
		} finally {
			await rm(file("data/nginx/proxy_host/991.conf"), { force: true });
		}
	});

	it("logs the lists with country rules when no database is usable", async () => {
		await addList("allow");
		const log = recorder();
		await geo.startGeoipNginx({ log });
		assert.ok(
			log.lines.some(
				(line) => line.startsWith("GeoIP: 1 access list(s) have country rules") && NO_DATABASE.test(line),
			),
			log.lines.join("\n"),
		);
		await addDatabase();
		const quiet = recorder();
		await geo.startGeoipNginx({ log: quiet });
		assert.deepEqual(quiet.lines, []);
	});
});

describe("syncGeoipConf", () => {
	it("writes the database variant with the provider's file, then off when the file is gone", async () => {
		await addDatabase();
		const reloadsBefore = reloads(api);
		assert.deepEqual(await geo.syncGeoipConf(), { variant: "database", changed: true });
		assert.equal(
			await conf(),
			`# GeoIP country database of the active provider (Settings, GeoIP), written by NPMpro\ngeoip_country ${database()};\ngeo $npmpro_geo_db {\n  default 1;\n}\n`,
		);
		assert.equal(await nginxTests(), 1);
		assert.equal(reloads(api), reloadsBefore + 1);

		await rm(database());
		assert.deepEqual(await geo.syncGeoipConf(), { variant: "off", changed: true });
		assert.match(await conf(), OFF_LINE);
		assert.equal(reloads(api), reloadsBefore + 2);
	});

	it("leaves an unchanged file alone: no nginx -t, no reload", async () => {
		await addDatabase();
		await geo.syncGeoipConf();
		await api.outside.clearCalls();
		const reloadsBefore = reloads(api);
		assert.deepEqual(await geo.syncGeoipConf(), { variant: "database", changed: false });
		assert.equal(await nginxTests(), 0);
		assert.equal(reloads(api), reloadsBefore);
	});

	it("tests and reloads a replaced file of the same name with force", async () => {
		await addDatabase();
		await geo.syncGeoipConf();
		await api.outside.clearCalls();
		const reloadsBefore = reloads(api);
		assert.deepEqual(await geo.syncGeoipConf({ force: true }), { variant: "database", changed: true });
		assert.equal(await nginxTests(), 1);
		assert.equal(reloads(api), reloadsBefore + 1);
	});

	it("writes no geoip_country line of its own under a custom directive", async () => {
		await addDatabase();
		await writeFile(custom(), "geoip_country /etc/own/GeoIP.dat;\n");
		assert.equal((await geo.syncGeoipConf({ reload: false })).variant, "custom");
		const text = await conf();
		assert.doesNotMatch(text, OWN_LINE);
		assert.match(text, DEFAULT_ON);
	});

	it("falls back to the off variant when a duplicate the detection misses makes nginx -t fail", async () => {
		await addList("deny");
		await addDatabase();
		// after another statement on the same line: hasCustomDirective does not see it, nginx does
		await writeFile(custom(), "map_hash_bucket_size 128; geoip_country /etc/own/GeoIP.dat;\n");
		await api.outside.hookCommand("nginx", duplicateNginx());
		const log = recorder();
		const reloadsBefore = reloads(api);
		assert.deepEqual(await geo.syncGeoipConf({ log }), { variant: "off", changed: false });
		assert.match(await conf(), OFF_LINE);
		assert.ok(
			log.lines.some((line) => FAILS_OPEN.test(line) && line.includes("directive is duplicate in")),
			log.lines.join("\n"),
		);
		// the whole nginx output only at debug level
		assert.ok(log.debugLines.some((line) => line.includes("test failed")));
		// the file on disk is the one it had: nothing to reload
		assert.equal(reloads(api), reloadsBefore);
		const { data } = await state();
		assert.equal(data.reason, "nginx");
		assert.match(data.error, DUPLICATE);
	});

	it("keeps the database variant and the country rules when another file fails nginx -t", async () => {
		await addList("deny");
		await addDatabase();
		await api.outside.hookCommand("nginx", brokenHostNginx());
		await writeFile(file("data/nginx/proxy_host/991.conf"), "# BADHOST\n");
		try {
			const log = recorder();
			const reloadsBefore = reloads(api);
			assert.deepEqual(await geo.syncGeoipConf({ log }), { variant: "database", changed: true });
			assert.match(await conf(), DATABASE_LINE);
			assert.ok(
				log.lines.some((line) => NO_FALLBACK.test(line) && line.includes("991.conf")),
				log.lines.join("\n"),
			);
			// a reload would fail the same way
			assert.equal(reloads(api), reloadsBefore);
			assert.notEqual((await state())?.state, "bad");
		} finally {
			await rm(file("data/nginx/proxy_host/991.conf"), { force: true });
		}
	});
});

describe("writeGeoipLists", () => {
	it("keeps a passing variable for a list a host config still names", async () => {
		const id = await addList("deny", ["FR", "US"]);
		await writeFile(file("data/nginx/proxy_host/990.conf"), "if ($npmpro_geo_99 = 0) { return 444; }\n");
		try {
			assert.deepEqual(await geo.writeGeoipLists(), { lists: 1 });
			const text = await lists();
			assert.match(text, new RegExp(`\\$npmpro_geo_${id} \\{\\n {2}default 1;`, "u"));
			assert.match(text, FR_BLOCKED);
			assert.match(text, PASSING_99);
			await rm(file("data/nginx/proxy_host/990.conf"));
			await geo.writeGeoipLists();
			assert.doesNotMatch(await lists(), NAMES_99);
		} finally {
			await rm(file("data/nginx/proxy_host/990.conf"), { force: true });
		}
	});
});

describe("reportGeoipState", () => {
	it("is bad with reason missing while a list has a mode and no database is usable, and missing wins", async () => {
		const { reportGeoipState } = await import("../internal/geoip-state.js");
		await addList("allow");
		await reportGeoipState();
		assert.deepEqual(await state(), { state: "bad", data: { reason: "missing" } });

		await setLastError("DB-IP returned HTTP 503");
		await reportGeoipState();
		assert.deepEqual(await state(), { state: "bad", data: { reason: "missing" } });

		await setLastError(null);
		await addDatabase();
		await geo.syncGeoipConf({ reload: false });
		assert.equal((await state()).state, "ok");
	});

	it("is ok without a list with a mode, also without a database", async () => {
		const { reportGeoipState } = await import("../internal/geoip-state.js");
		await addList("off", []);
		await reportGeoipState();
		assert.notEqual((await state())?.state, "bad");
	});

	it("is bad with reason nginx while nginx runs the fail-open variant although the database is usable", async () => {
		await addList("deny");
		await addDatabase();
		await writeFile(custom(), "map_hash_bucket_size 128; geoip_country /etc/own/GeoIP.dat;\n");
		await api.outside.hookCommand("nginx", duplicateNginx());
		await geo.syncGeoipConf({ log: recorder() });
		assert.equal((await state()).data.reason, "nginx");
		// the custom file fixed: the next sync uses the database and the state is ok again
		await rm(custom());
		await geo.syncGeoipConf({ log: recorder() });
		assert.match(await conf(), DATABASE_LINE);
		assert.equal((await state()).state, "ok");
	});
});

describe("the callers", () => {
	it("a download that replaced the active provider's Country file tests and reloads, another edition does not", async () => {
		const { default: setting } = await import("../internal/monitoring-setting.js");
		await addDatabase();
		await geo.syncGeoipConf();
		await api.outside.clearCalls();
		const reloadsBefore = reloads(api);
		await setting.recordGeoipResult({ ok: true, updated: ["ASN"], provider: "dbip" });
		assert.equal(await nginxTests(), 0);
		await setting.recordGeoipResult({ ok: true, updated: ["Country"], provider: "dbip" });
		assert.equal(await nginxTests(), 1);
		assert.equal(reloads(api), reloadsBefore + 1);
	});

	it("a provider apply writes geoip.conf for the provider's Country file", async () => {
		const { applyGeoipProvider } = await import("../internal/geoip-provider.js");
		await addDatabase();
		const reloadsBefore = reloads(api);
		assert.equal(await applyGeoipProvider({ log: recorder() }), "dbip");
		assert.match(await conf(), new RegExp(`geoip_country ${database()};`, "u"));
		assert.equal(reloads(api), reloadsBefore + 1);
	});
});
