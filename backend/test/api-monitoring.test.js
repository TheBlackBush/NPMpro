import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { c as createArchive } from "tar";
import { up as upTotals } from "../migrations/20261110120000_traffic_totals.js";
import { startApi } from "./support/api.js";
import { reloads } from "./support/hosts.js";

// /settings/monitoring, /settings/geoip* and /monitoring/* (schema/paths/settings/monitoring, settings/geoip,
// monitoring, wiki/Monitoring): the traffic statistics switch and what it stores, the GeoIP download and the read-only
// monitoring answers.

const SETTINGS = "/settings/monitoring";
const GEOIP = "/settings/geoip";
const ACCESS_LOG_CONF = "data/npmpro/nginx/access-log.conf";
const ALOG = "access_log /data/nginx/logs/access.log alog;\n";
const AJSON = "access_log /data/nginx/logs/access.log ajson;\n";
const MAXMIND = "https://download.maxmind.com";
const COUNTRY_DOWNLOAD = "/geoip/databases/GeoLite2-Country/download?suffix=tar.gz";
const HTTP_401 = /HTTP 401/u;
const MISSING_CREDENTIALS = /MaxMind account ID and license key are required/u;
const KEY = "maxmind-license-SECRET-4711";
const MINUTE = Math.floor(Date.now() / 60000);
const HOUR = Math.floor(Date.now() / 3600000);

let api;
let admin;
let hostId;

const monitoring = async () => {
	const done = await admin.get(SETTINGS);
	assert.equal(done.status, 200, done.text);
	return done.body;
};
const saved = async (body) => {
	const done = await admin.put(SETTINGS, body);
	assert.equal(done.status, 200, done.text);
	return done.body;
};
const refused = async (body, pattern) => {
	const done = await admin.put(SETTINGS, body);
	assert.equal(done.status, 400, `${JSON.stringify(body)}: ${done.text}`);
	if (pattern) assert.match(done.body.error.message, pattern);
};
const count = async (table) => Number((await api.db(table).count({ n: "*" }).first()).n);
const refuseWhile = (file, marker) =>
	api.outside.hookCommand(
		"nginx",
		`#!/bin/sh\nif grep -q '${marker}' "${api.root}/${file}" 2>/dev/null; then echo "nginx: [emerg] refused" >&2; exit 1; fi\n`,
	);
const nginxOk = () => api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
const storedMeta = async (id) => {
	const row = await api.db("setting").where({ id }).first();
	return row ? (typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta) : null;
};
// a MaxMind style archive: a dated folder holding the Country test database
const countryArchive = async () => {
	const root = await mkdtemp(path.join(tmpdir(), "npa-geo-"));
	const folder = path.join(root, "GeoLite2-Country_20261101");
	await mkdir(folder);
	await copyFile(
		path.join(import.meta.dirname, "fixtures/GeoLite2-Country-Test.mmdb"),
		path.join(folder, "GeoLite2-Country.mmdb"),
	);
	const file = path.join(root, "country.tar.gz");
	await createArchive({ gzip: true, file, cwd: root }, ["GeoLite2-Country_20261101"]);
	return readFile(file);
};
const waitFor = async (check, what) => {
	for (let attempt = 0; attempt < 500; attempt += 1) {
		const value = await check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`timed out waiting for ${what}`);
};

before(async () => {
	api = await startApi();
	admin = await api.admin();
	const host = await admin.post("/nginx/proxy-hosts", {
		domain_names: ["shop.example.com", "www.shop.example.com"],
		forward_scheme: "http",
		forward_host: "10.0.5.1",
		forward_port: 8080,
	});
	assert.equal(host.status, 201, host.text);
	hostId = host.body.id;
});
after(() => api?.stop());

it("shows the defaults of the traffic statistics settings", async () => {
	assert.deepEqual(await monitoring(), {
		traffic_enabled: false,
		retention_days: 30,
		show_ips: false,
		unique_visitors: false,
		visitors_cap: 100000,
		locked: [],
		locked_by: {},
	});
});

it("refuses invalid traffic statistics settings with 400 and stores nothing", async () => {
	const bodies = [
		{},
		{ extra: true },
		{ retention_days: 6 },
		{ retention_days: 366 },
		{ retention_days: 7.5 },
		{ retention_days: "many" },
		{ visitors_cap: 999 },
		{ visitors_cap: 1000001 },
		{ traffic_enabled: "yes" },
		{ show_ips: 1.5 },
		{ unique_visitors: [] },
		{ delete_stats: "yes" },
	];
	for (const body of bodies) await refused(body);
	assert.equal(await storedMeta("monitoring"), null);
});

it("switches traffic statistics on: the access log is turned on and nginx reloads", async () => {
	assert.equal(await api.read(ACCESS_LOG_CONF), "access_log off;\n");
	const calls = reloads(api);
	const view = await saved({ traffic_enabled: true, retention_days: 90, visitors_cap: 5000 });
	assert.equal(view.traffic_enabled, true);
	assert.equal(view.retention_days, 90);
	assert.equal(view.visitors_cap, 5000);
	assert.equal(await api.read(ACCESS_LOG_CONF), ALOG);
	assert.equal(reloads(api), calls + 1);
	assert.deepEqual(await storedMeta("monitoring"), { traffic_enabled: true, retention_days: 90, visitors_cap: 5000 });
	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	assert.equal(audit.action, "updated");
	assert.equal(JSON.parse(audit.meta).id, "monitoring");
	// the same value again does not touch the access log
	await saved({ retention_days: 90 });
	assert.equal(reloads(api), calls + 1);
});

it("a stored json log format stays ajson when traffic statistics are turned off and on", async () => {
	const done = await admin.put("/settings/runtime/logs", { log_format: "json" });
	assert.equal(done.status, 200, done.text);
	try {
		// traffic is on: the format change rewrote the include
		assert.equal(await api.read(ACCESS_LOG_CONF), AJSON);
		await saved({ traffic_enabled: false });
		assert.equal(await api.read(ACCESS_LOG_CONF), "access_log off;\n");
		await saved({ traffic_enabled: true });
		assert.equal(await api.read(ACCESS_LOG_CONF), AJSON);
	} finally {
		const back = await admin.put("/settings/runtime/logs", { log_format: "classic" });
		assert.equal(back.status, 200, back.text);
	}
	assert.equal(await api.read(ACCESS_LOG_CONF), ALOG);
});

it("keeps the stored setting when nginx refuses the access log change", async () => {
	const calls = reloads(api);
	await refuseWhile(ACCESS_LOG_CONF, "access_log off");
	try {
		await refused({ traffic_enabled: false }, /Could not switch the access log/u);
	} finally {
		await nginxOk();
	}
	assert.equal((await monitoring()).traffic_enabled, true);
	assert.equal(await api.read(ACCESS_LOG_CONF), ALOG);
	assert.ok(reloads(api) >= calls);
	assert.equal((await storedMeta("monitoring")).traffic_enabled, true);
});

it("answers the traffic statistics from the stored counts, grouped per host, with countries and networks", async () => {
	await api.db("traffic_minute").insert([
		{ bucket: MINUTE, host: "shop.example.com", status_class: "2xx", requests: 8, bytes: 800 },
		{ bucket: MINUTE - 1, host: "www.shop.example.com", status_class: "5xx", requests: 2, bytes: 200 },
		{ bucket: MINUTE - 2, host: "_other", status_class: "4xx", requests: 5, bytes: 50 },
	]);
	await api.db("traffic_country_hour").insert([
		{ bucket: HOUR, host: "shop.example.com", country: "DE", requests: 6 },
		{ bucket: HOUR, host: "shop.example.com", country: "FR", requests: 2 },
	]);
	await api
		.db("traffic_asn_hour")
		.insert([{ bucket: HOUR, host: "shop.example.com", asn: 64500, asn_name: "Example Net", requests: 8 }]);
	await api
		.db("traffic_ip_hour")
		.insert([{ bucket: HOUR, host: "shop.example.com", ip: "203.0.113.9", requests: 8 }]);
	// the all-hosts view reads the total rows, which the flush writes: the backfill writes them for these rows
	await upTotals(api.db);

	const done = await admin.get("/monitoring/traffic?range=1h");
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.totals, { requests: 15, bytes: 1050, error_rate: 7 / 15 });
	assert.equal(done.body.series.length, 60);
	assert.deepEqual(done.body.countries, [
		{ country: "DE", requests: 6 },
		{ country: "FR", requests: 2 },
	]);
	assert.deepEqual(done.body.top_asns, [{ asn: 64500, asn_name: "Example Net", requests: 8 }]);
	// the two names of the host are one entry, the _other key is Other hosts
	const hosts = done.body.top_hosts.map((entry) => [entry.host_id, entry.host_type, entry.requests, entry.bytes]);
	assert.deepEqual(hosts, [
		[hostId, "proxy", 10, 1000],
		[null, "other", 5, 50],
	]);
	// visitor IPs are off, so none are returned
	assert.equal("top_ips" in done.body, false);
	assert.equal(done.text.includes("203.0.113.9"), false);
	assert.equal(done.body.status.enabled, true);
	assert.equal(done.body.status.geoip, false);
	assert.equal(done.body.status.geoip_provider, "dbip");
	assert.equal(done.body.status.unique_visitors, false);
	assert.deepEqual(done.body.recent, []);
});

it("filters the traffic by host name or by host id and type, and answers every range", async () => {
	const byName = await admin.get("/monitoring/traffic?range=24h&host=WWW.shop.example.com");
	assert.equal(byName.status, 200, byName.text);
	assert.equal(byName.body.totals.requests, 2);
	const byId = await admin.get(`/monitoring/traffic?range=24h&host_id=${hostId}&host_type=proxy`);
	assert.equal(byId.status, 200, byId.text);
	assert.equal(byId.body.totals.requests, 10);
	for (const range of ["7d", "30d"]) {
		const done = await admin.get(`/monitoring/traffic?range=${range}`);
		assert.equal(done.status, 200, `${range}: ${done.text}`);
		assert.equal(done.body.totals.requests, 15, range);
	}
	assert.equal((await admin.get("/monitoring/traffic")).body.totals.requests, 15);
});

it("refuses an invalid traffic query with 400 and an unknown host with 404", async () => {
	for (const query of [
		"range=2h",
		"range=",
		`host_id=${hostId}`,
		"host_type=proxy",
		"host_id=0&host_type=proxy",
		"host_id=abc&host_type=proxy",
		`host_id=${hostId}&host_type=stream`,
		`host=${"x".repeat(256)}`,
	]) {
		const done = await admin.get(`/monitoring/traffic?${query}`);
		assert.equal(done.status, query === "range=" ? 200 : 400, `${query}: ${done.text}`);
	}
	assert.equal((await admin.get("/monitoring/traffic?host_id=999999&host_type=proxy")).status, 404);
	assert.equal((await admin.get(`/monitoring/traffic?host_id=${hostId}&host_type=dead`)).status, 404);
});

it("shows the dashboard numbers of today, and nulls while a source is off", async () => {
	const done = await admin.get("/monitoring/summary");
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.requests_today, 15);
	assert.equal(done.body.series_24h.length > 0, true);
	assert.equal(done.body.active_bans, null);
	assert.equal(done.body.top_country_today, null);
	// no GeoIP database and no CrowdSec in the test root: the new fields follow the same rules
	assert.equal(done.body.top_countries_today, null);
	assert.equal(done.body.bans_added_24h, null);
	assert.equal(done.body.top_ban_reasons, null);
	assert.equal(done.body.visitors_today, null);
	assert.equal(typeof done.body.error_rate_today, "number");
	assert.equal(typeof done.body.client_errors_today, "number");
	assert.equal(typeof done.body.server_errors_today, "number");
});

it("turns visitor IPs and unique visitors on, and off again deletes what they stored", async () => {
	const view = await saved({ show_ips: true, unique_visitors: true });
	assert.equal(view.show_ips, true);
	assert.equal(view.unique_visitors, true);
	await api
		.db("traffic_visitor")
		.insert([{ day: Math.floor(Date.now() / 86400000), host: "shop.example.com", hash: "a1b2c3" }]);
	const withIps = await admin.get("/monitoring/traffic?range=1h&host=shop.example.com");
	assert.equal(withIps.status, 200, withIps.text);
	assert.deepEqual(withIps.body.top_ips, [{ ip: "203.0.113.9", requests: 8 }]);
	assert.equal(withIps.body.status.unique_visitors, true);
	assert.equal(withIps.body.totals.visitors, 1);
	const summary = await admin.get("/monitoring/summary");
	assert.equal(summary.body.visitors_today, 1);

	await saved({ show_ips: false });
	assert.equal(await count("traffic_ip_hour"), 0);
	assert.equal((await count("traffic_visitor")) > 0, true);
	await saved({ unique_visitors: false });
	assert.equal(await count("traffic_visitor"), 0);
	assert.equal(await count("traffic_minute"), 6);
	const without = await admin.get("/monitoring/traffic?range=1h&host=shop.example.com");
	assert.equal("top_ips" in without.body, false);
	assert.equal("visitors" in without.body.totals, false);
});

it("deletes the stored statistics only together with switching traffic statistics off", async () => {
	await refused({ delete_stats: true }, /delete_stats can only be sent together/u);
	await refused({ traffic_enabled: true, delete_stats: true }, /delete_stats can only be sent together/u);
	assert.equal(await count("traffic_minute"), 6);
	const calls = reloads(api);

	const view = await saved({ traffic_enabled: false, delete_stats: true });
	assert.equal(view.traffic_enabled, false);
	for (const table of [
		"traffic_minute",
		"traffic_hour",
		"traffic_country_hour",
		"traffic_asn_hour",
		"traffic_ip_hour",
	]) {
		assert.equal(await count(table), 0, table);
	}
	assert.equal(await api.read(ACCESS_LOG_CONF), "access_log off;\n");
	assert.equal(reloads(api), calls + 1);
	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	assert.equal(JSON.parse(audit.meta).deleted_stats, true);
	// off and nothing to delete: the answer holds zero counts and the statistics are marked off
	const done = await admin.get("/monitoring/traffic?range=7d&host=gone.example.com");
	assert.equal(done.body.totals.requests, 0);
	assert.equal(done.body.status.enabled, false);
	const summary = await admin.get("/monitoring/summary");
	assert.equal(summary.body.requests_today, null);
	assert.equal(summary.body.series_24h, null);
	await refused({ traffic_enabled: false, delete_stats: true }, /delete_stats can only be sent together/u);
});

it("keeps the statistics when traffic statistics go off without delete_stats", async () => {
	await saved({ traffic_enabled: true });
	await api
		.db("traffic_minute")
		.insert({ bucket: MINUTE, host: "shop.example.com", status_class: "2xx", requests: 1, bytes: 1 });
	await saved({ traffic_enabled: false });
	assert.equal(await count("traffic_minute"), 1);
});

it("answers CrowdSec as not configured while there is no bouncer config", async () => {
	const done = await admin.get("/monitoring/crowdsec");
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.configured, false);
	assert.equal(done.body.reachable, false);
	assert.equal(done.body.total, 0);
	assert.deepEqual(done.body.newest, []);
});

it("shows the GeoIP settings without the license key, and saves account, key and editions", async () => {
	const defaults = await admin.get(GEOIP);
	assert.equal(defaults.status, 200, defaults.text);
	assert.deepEqual(defaults.body, {
		account_id: "",
		editions: ["GeoLite2-Country", "GeoLite2-ASN"],
		provider: "dbip",
		dbip_editions: ["Country", "ASN"],
		license_key_set: false,
		locked: [],
		locked_by: {},
		secret_error: false,
		last_update: null,
		last_check: null,
		last_error: null,
	});

	// no download starts without both credentials, so nothing is requested
	const done = await admin.put(GEOIP, { account_id: "123456", editions: ["GeoLite2-ASN"] });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.account_id, "123456");
	assert.deepEqual(done.body.editions, ["GeoLite2-ASN"]);
	assert.equal(done.body.license_key_set, false);
});

it("stores the license key encrypted, never returns it, and keeps it when the field is empty", async () => {
	const done = await admin.put(GEOIP, { license_key: KEY, editions: [] });
	assert.equal(done.status, 200, done.text);
	assert.equal(done.body.license_key_set, true);
	assert.equal(done.text.includes(KEY), false);
	assert.equal((await admin.get(GEOIP)).text.includes(KEY), false);
	const meta = await storedMeta("geoip");
	assert.equal(JSON.stringify(meta).includes(KEY), false);
	assert.match(meta.license_key, /^v1:/u);
	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	assert.equal(audit.meta.includes(KEY), false);
	assert.equal(JSON.parse(audit.meta).id, "geoip");

	const kept = await admin.put(GEOIP, { license_key: "", account_id: "654321" });
	assert.equal(kept.body.license_key_set, true);
	assert.equal((await storedMeta("geoip")).license_key, meta.license_key);
	assert.equal((await storedMeta("geoip")).account_id, "654321");
});

it("refuses invalid GeoIP settings with 400", async () => {
	for (const body of [
		{},
		{ extra: 1 },
		{ account_id: "12ab" },
		{ account_id: "12345678901" },
		{ license_key: "x".repeat(256) },
		{ editions: ["GeoLite2-Planet"] },
		{ provider: "geolite" },
		{ dbip_editions: ["City"] },
		{ dbip_editions: ["ASN", "ASN"] },
		{ dbip_editions: ["Country", "ASN", "ASN"] },
		{ editions: ["GeoLite2-Country", "GeoLite2-Country"] },
		{ editions: ["GeoLite2-Country", "GeoLite2-ASN", "GeoLite2-City", "GeoLite2-City"] },
	]) {
		const done = await admin.put(GEOIP, body);
		assert.equal(done.status, 400, JSON.stringify(body));
	}
});

it("downloads the databases when the credentials change, and records the outcome", async () => {
	const archive = await countryArchive();
	api.outside.http
		.get(MAXMIND)
		.intercept({ path: COUNTRY_DOWNLOAD, method: "GET" })
		.reply(200, archive, { headers: { "content-type": "application/gzip" } });
	const done = await admin.put(GEOIP, { account_id: "777", license_key: KEY, editions: ["GeoLite2-Country"] });
	assert.equal(done.status, 200, done.text);
	const meta = await waitFor(async () => {
		const stored = await storedMeta("geoip");
		const file = await readFile(path.join(api.root, "data/goaccess/geoip/GeoLite2-Country.mmdb")).catch(() => null);
		return stored?.last_update && file ? stored : null;
	}, "the GeoIP update");
	assert.equal(meta.last_error, null);
	assert.equal(
		await api
			.db("setting")
			.where({ id: "geoip" })
			.first()
			.then((row) => Boolean(row)),
		true,
	);
	const view = await admin.get(GEOIP);
	assert.ok(view.body.last_update);
	assert.equal(view.body.last_error, null);
	const files = await readFile(path.join(api.root, "data/goaccess/geoip/GeoLite2-Country.mmdb"));
	assert.ok(files.length > 100);
	// the readers reopen after the result is recorded (and geoip.conf is synced for the new Country file)
	const traffic = await waitFor(async () => {
		const answer = await admin.get("/monitoring/traffic?range=1h&host=geo.example.com");
		return answer.body.status.geoip ? answer : null;
	}, "the GeoIP readers");
	assert.equal(traffic.body.status.geoip_provider, "maxmind");
	assert.ok(view.body.last_check);
});

it("runs the update now and answers what happened, also when MaxMind refuses", async () => {
	const archive = await countryArchive();
	api.outside.http.get(MAXMIND).intercept({ path: COUNTRY_DOWNLOAD, method: "GET" }).reply(200, archive);
	const ok = await admin.post(`${GEOIP}/update`);
	assert.equal(ok.status, 200, ok.text);
	assert.equal(ok.body.ok, true);
	assert.deepEqual(ok.body.updated, ["GeoLite2-Country"]);

	api.outside.http.get(MAXMIND).intercept({ path: COUNTRY_DOWNLOAD, method: "GET" }).reply(401, "no");
	const failed = await admin.post(`${GEOIP}/update`);
	assert.equal(failed.status, 200, failed.text);
	assert.equal(failed.body.ok, false);
	assert.equal(failed.body.error, "GeoLite2-Country: MaxMind returned HTTP 401");
	assert.equal(failed.text.includes(KEY), false);
	assert.equal((await admin.get(GEOIP)).body.last_error, "GeoLite2-Country: MaxMind returned HTTP 401");
	assert.equal((await storedMeta("geoip")).last_error, "GeoLite2-Country: MaxMind returned HTTP 401");
});

it("answers the update now with the missing credentials", async () => {
	await api.db("setting").where({ id: "geoip" }).del();
	const original = process.env.GEOIP_PROVIDER;
	process.env.GEOIP_PROVIDER = "maxmind";
	let done;
	try {
		done = await admin.post(`${GEOIP}/update`);
	} finally {
		if (original === undefined) delete process.env.GEOIP_PROVIDER;
		else process.env.GEOIP_PROVIDER = original;
	}
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body, {
		ok: false,
		updated: [],
		error: "MaxMind account ID and license key are required",
		provider: "maxmind",
	});
	// as before the provider choice: the answer names the missing credentials, nothing is stored
	assert.equal(await storedMeta("geoip"), null);
});

const withEnv = async (name, value, run) => {
	const original = process.env[name];
	process.env[name] = value;
	try {
		return await run();
	} finally {
		if (original === undefined) delete process.env[name];
		else process.env[name] = original;
	}
};
const geoipState = () => api.db("npmpro_notification_state").where({ key: "geoip.failed:geoip" }).first();

it("stores the provider and the DB-IP editions, and refuses a switch the environment locks", async () => {
	await api.db("setting").where({ id: "geoip" }).del();
	const maxmind = await admin.put(GEOIP, { provider: "maxmind" });
	assert.equal(maxmind.status, 200, maxmind.text);
	assert.equal(maxmind.body.provider, "maxmind");
	assert.equal((await admin.get(GEOIP)).body.provider, "maxmind");
	assert.equal((await storedMeta("geoip")).provider, "maxmind");

	const editions = await admin.put(GEOIP, { dbip_editions: ["ASN"] });
	assert.equal(editions.status, 200, editions.text);
	assert.deepEqual(editions.body.dbip_editions, ["ASN"]);
	assert.deepEqual((await storedMeta("geoip")).dbip_editions, ["ASN"]);
	assert.equal((await admin.put(GEOIP, { dbip_editions: ["City"] })).status, 400);

	await withEnv("GEOIP_PROVIDER", "dbip", async () => {
		const locked = await admin.put(GEOIP, { provider: "maxmind" });
		assert.equal(locked.status, 200, locked.text);
		assert.equal(locked.body.provider, "dbip");
		assert.ok(locked.body.locked.includes("provider"));
		assert.equal(locked.body.locked_by.provider, "GEOIP_PROVIDER");
		assert.equal((await storedMeta("geoip")).provider, "maxmind");
	});
	await withEnv("GEOIP_DBIP_EDITIONS", "Country", async () => {
		const view = await admin.get(GEOIP);
		assert.deepEqual(view.body.dbip_editions, ["Country"]);
		assert.equal(view.body.locked_by.dbip_editions, "GEOIP_DBIP_EDITIONS");
	});
});

it("lists GEOIP_PROVIDER and GEOIP_DBIP_EDITIONS in the environment answer when they are set", async () => {
	const names = async () => {
		const done = await admin.get("/settings/environment");
		assert.equal(done.status, 200, done.text);
		return JSON.stringify(done.body);
	};
	assert.equal((await names()).includes("GEOIP_PROVIDER"), false);
	await withEnv("GEOIP_PROVIDER", "dbip", () =>
		withEnv("GEOIP_DBIP_EDITIONS", "ASN", async () => {
			const text = await names();
			assert.ok(text.includes("GEOIP_PROVIDER"), text);
			assert.ok(text.includes("GEOIP_DBIP_EDITIONS"), text);
		}),
	);
});

it("clears the last error on a provider switch and re-evaluates the failed state", async () => {
	await api.db("setting").where({ id: "geoip" }).del();
	await api.db("npmpro_notification_state").where({ key: "geoip.failed:geoip" }).delete();
	await admin.put(GEOIP, { provider: "maxmind" });
	const meta = await storedMeta("geoip");
	await api
		.db("setting")
		.where({ id: "geoip" })
		.update({ meta: JSON.stringify({ ...meta, last_error: "old trouble" }) });
	assert.equal((await admin.get(GEOIP)).body.last_error, "old trouble");
	await api.db("npmpro_notification_state").where({ key: "geoip.failed:geoip" }).delete();
	await api.db("npmpro_notification_state").insert({
		key: "geoip.failed:geoip",
		event: "geoip.failed",
		object_id: "geoip",
		state: "bad",
		since: new Date(),
		data: JSON.stringify({ reason: "download", error: "old trouble" }),
	});
	const switched = await admin.put(GEOIP, { provider: "dbip" });
	assert.equal(switched.status, 200, switched.text);
	assert.equal(switched.body.last_error, null);
	assert.equal((await storedMeta("geoip")).last_error, null);
	assert.equal((await geoipState()).state, "ok");
	// the download of the switch starts in the background (no network in the tests): let it end before the next case
	await waitFor(async () => (await storedMeta("geoip")).last_check, "the download after the switch");
});

it("a switch to MaxMind without credentials is an incomplete setup: no last error, no geoip.failed alert", async () => {
	await api.db("setting").where({ id: "geoip" }).del();
	await api.db("npmpro_notification_state").where({ key: "geoip.failed:geoip" }).delete();
	await api.db("setting").insert({
		id: "geoip",
		name: "GeoIP",
		description: "GeoIP",
		value: "geoip",
		meta: JSON.stringify({ provider: "dbip", dbip_editions: [], last_error: "DB-IP returned HTTP 503" }),
	});
	await api.db("npmpro_notification_state").insert({
		key: "geoip.failed:geoip",
		event: "geoip.failed",
		object_id: "geoip",
		state: "bad",
		since: new Date(),
		data: JSON.stringify({ reason: "download", error: "DB-IP returned HTTP 503" }),
	});
	const deliveries = async () =>
		(await api.db("npmpro_notification_delivery").where({ event: "geoip.failed" })).length;
	const sent = await deliveries();

	const switched = await admin.put(GEOIP, { provider: "maxmind" });
	assert.equal(switched.status, 200, switched.text);
	assert.equal(switched.body.provider, "maxmind");
	assert.equal(switched.body.account_id, "");
	assert.equal(switched.body.license_key_set, false);
	// "Update now" queues behind the run the switch started, so its answer comes after that run ended
	const now = await admin.post(`${GEOIP}/update`);
	assert.equal(now.body.ok, false);
	assert.match(now.body.error, MISSING_CREDENTIALS);

	const meta = await storedMeta("geoip");
	assert.equal(meta.last_error, null);
	assert.equal(meta.last_check ?? null, null);
	assert.equal((await admin.get(GEOIP)).body.last_error, null);
	assert.equal((await geoipState()).state, "ok");
	assert.equal(await deliveries(), sent);
});

it("reports geoip.failed with the reason download and resolves it with the next good run", async () => {
	await api.db("setting").where({ id: "geoip" }).del();
	await api.db("npmpro_notification_state").where({ key: "geoip.failed:geoip" }).delete();
	api.outside.http.get(MAXMIND).intercept({ path: COUNTRY_DOWNLOAD, method: "GET" }).reply(401, "no");
	await admin.put(GEOIP, {
		account_id: "888",
		license_key: KEY,
		editions: ["GeoLite2-Country"],
		provider: "maxmind",
	});
	await waitFor(async () => (await geoipState())?.state === "bad", "the failed state");
	const bad = await geoipState();
	assert.equal(JSON.parse(bad.data).reason, "download");
	assert.match(JSON.parse(bad.data).error, HTTP_401);

	const archive = await countryArchive();
	api.outside.http.get(MAXMIND).intercept({ path: COUNTRY_DOWNLOAD, method: "GET" }).reply(200, archive);
	const ok = await admin.post(`${GEOIP}/update`);
	assert.equal(ok.body.ok, true, ok.text);
	assert.equal(ok.body.provider, "maxmind");
	assert.equal((await geoipState()).state, "ok");
});

it("answers 401 without a session on every monitoring route", async () => {
	const none = api.client();
	for (const [method, url, body] of [
		["get", SETTINGS],
		["put", SETTINGS, { retention_days: 10 }],
		["get", GEOIP],
		["put", GEOIP, { account_id: "1" }],
		["post", `${GEOIP}/update`],
		["get", "/monitoring/traffic"],
		["get", "/monitoring/crowdsec"],
		["get", "/monitoring/summary"],
	]) {
		assert.equal((await none[method](url, body)).status, 401, `${method} ${url}`);
	}
});

it("refuses a user who is not an administrator on every monitoring route", async () => {
	const user = await api.limited({ visibility: "all" });
	const before_ = await monitoring();
	for (const [method, url, body] of [
		["get", SETTINGS],
		["put", SETTINGS, { retention_days: 10 }],
		["get", GEOIP],
		["put", GEOIP, { account_id: "1" }],
		["post", `${GEOIP}/update`],
		["get", "/monitoring/traffic"],
		["get", "/monitoring/crowdsec"],
		["get", "/monitoring/summary"],
	]) {
		assert.equal((await user[method](url, body)).status, 403, `${method} ${url}`);
	}
	assert.deepEqual(await monitoring(), before_);
});
