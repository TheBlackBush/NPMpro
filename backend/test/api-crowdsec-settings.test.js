import assert from "node:assert/strict";
import http from "node:http";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { reloads } from "./support/hosts.js";

const KEY = "good-key-0123456789";
const BAN_PAGE = "<style>p{color:red}</style><p>banned</p>";

let api;
let admin;
let lapi;
let lapiUrl;
let lapiHits = 0;

before(async () => {
	api = await startApi({
		files: { "/data/crowdsec/ban.html": BAN_PAGE, "/data/crowdsec/captcha.html": "<p>captcha</p>" },
	});
	admin = await api.admin();
	lapi = http.createServer((req, res) => {
		lapiHits += 1;
		const ok = req.headers["x-api-key"] === KEY;
		res.writeHead(ok ? 200 : 403, { "content-type": "application/json" });
		res.end(ok ? "null" : "{}");
	});
	await new Promise((resolve) => lapi.listen(0, "127.0.0.1", resolve));
	lapiUrl = `http://127.0.0.1:${lapi.address().port}`;
});
after(async () => {
	if (lapi) await new Promise((resolve) => lapi.close(resolve));
	await api?.stop();
});

const settings = async () => (await admin.get("/settings/crowdsec")).body;
const conf = () => api.read("/data/crowdsec/crowdsec.conf");
const lastAudit = async () => {
	const row = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	return JSON.parse(row.meta);
};
const allAudit = async () => JSON.stringify(await api.db("audit_log").select("meta"));

it("answers the defaults of a fresh install without any secret", async () => {
	const res = await admin.get("/settings/crowdsec");
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.enabled, false);
	assert.equal(res.body.api_url, "http://127.0.0.1:8080");
	// empty on new installs (user decision 2026-11-12)
	assert.equal(res.body.appsec_url, "");
	assert.equal(res.body.ban_response, "page");
	assert.equal(res.body.api_key_set, false);
	assert.equal(res.body.captcha_secret_set, false);
	assert.equal(Object.hasOwn(res.body, "api_key"), false);
	assert.equal(Object.hasOwn(res.body, "captcha_secret_key"), false);
	assert.deepEqual(res.body.locked, []);
	assert.deepEqual(res.body.locked_by, {});
	assert.equal(res.body.secret_error, false);
	assert.deepEqual(res.body.status, { loaded: false, reachable: false, last_contact: null, error: null });
	assert.equal(
		await api.read("/data/npmpro/nginx/crowdsec.conf"),
		"# the CrowdSec bouncer is off (Settings, CrowdSec)\n",
	);
});

it("is for admins only", async () => {
	const user = await api.limited({ visibility: "all", access_lists: "manage" });
	assert.equal((await user.get("/settings/crowdsec")).status, 403);
	assert.equal((await user.put("/settings/crowdsec", { mode: "stream" })).status, 403);
	assert.equal((await user.post("/settings/crowdsec/test", {})).status, 403);
	assert.equal((await user.get("/settings/crowdsec/preview/ban")).status, 403);
	// without a session the normal /api access check answers first
	const anonymous = api.client();
	assert.equal((await anonymous.get("/settings/crowdsec/preview/ban")).status, 401);
	assert.equal((await anonymous.get("/settings/crowdsec")).status, 401);
	assert.equal((await settings()).mode, "live");
});

it("saves while the bouncer is off without a connection test, writes the file and reloads", async () => {
	const calls = reloads(api);
	const hits = lapiHits;
	const res = await admin.put("/settings/crowdsec", { captcha_expiration: 7200, api_url: "http://127.0.0.1:9" });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.captcha_expiration, 7200);
	assert.equal(reloads(api), calls + 1);
	assert.equal(lapiHits, hits);
	assert.match(await conf(), /^CAPTCHA_EXPIRATION=7200$/mu);
	assert.deepEqual(await lastAudit(), { id: "crowdsec", changed: ["api_url", "captcha_expiration"] });
});

it("refuses a failed connection test with its checks, then saves with force and marks the audit entry", async () => {
	const body = { enabled: true, api_url: lapiUrl, api_key: "wrong-key-secret", appsec_url: "" };
	const refused = await admin.put("/settings/crowdsec", body);
	assert.equal(refused.status, 409, refused.text);
	assert.equal(refused.body.error.message_i18n, "error.crowdsec-test-failed");
	assert.deepEqual(
		refused.body.error.checks.map((check) => [check.name, check.result]),
		[["lapi", "key_refused"]],
	);
	assert.equal((await settings()).enabled, false);
	assert.match(await conf(), /^ENABLED=false$/mu);

	const forced = await admin.put("/settings/crowdsec", { ...body, force: true });
	assert.equal(forced.status, 200, forced.text);
	assert.equal(forced.body.enabled, true);
	assert.equal(forced.body.api_key_set, true);
	assert.equal(forced.body.status.loaded, true);
	assert.equal(
		await api.read("/data/npmpro/nginx/crowdsec.conf"),
		"include /usr/local/nginx/conf/crowdsec-bouncer.conf;\n",
	);
	const audit = await lastAudit();
	assert.equal(audit.forced, true);
	assert.deepEqual(audit.changed.sort(), ["api_key", "api_url", "enabled"]);
	for (const text of [refused.text, forced.text, await allAudit()]) {
		assert.equal(text.includes("wrong-key-secret"), false);
	}
});

it("keeps the saved key for an empty one and removes it for null", async () => {
	const saved = await admin.put("/settings/crowdsec", { api_key: KEY });
	assert.equal(saved.status, 200, saved.text);
	assert.match(await conf(), new RegExp(`^API_KEY=${KEY}$`, "mu"));
	const kept = await admin.put("/settings/crowdsec", { api_key: "", mode: "stream" });
	assert.equal(kept.status, 200, kept.text);
	assert.match(await conf(), new RegExp(`^API_KEY=${KEY}$`, "mu"));
	const removed = await admin.put("/settings/crowdsec", { enabled: false, api_key: null });
	assert.equal(removed.status, 200, removed.text);
	assert.equal(removed.body.api_key_set, false);
	assert.match(await conf(), /^API_KEY=$/mu);
	assert.equal(saved.text.includes(KEY), false);
});

const includes = async () => [
	await api.read("/data/npmpro/nginx/crowdsec.conf"),
	await api.read("/data/npmpro/nginx/crowdsec-admin.conf"),
];

it("puts the file and the row back when nginx -t fails", async () => {
	const previous = await conf();
	const previousIncludes = await includes();
	await api.outside.failCommand("nginx", "nginx: [emerg] lua error");
	try {
		const res = await admin.put("/settings/crowdsec", { captcha_expiration: 900 });
		assert.equal(res.status, 400, res.text);
		assert.match(res.body.error.message, /lua error/u);
	} finally {
		await api.outside.passCommand("nginx");
	}
	assert.equal(await conf(), previous);
	assert.deepEqual(await includes(), previousIncludes);
	assert.equal((await settings()).captcha_expiration, 7200);
});

it("puts the file and the row back when the reload fails", async () => {
	const previous = await conf();
	const previousIncludes = await includes();
	api.outside.control.failNext = "reload refused";
	// admin_ui_excluded changes the admin include, so its rollback is seen too
	const res = await admin.put("/settings/crowdsec", { captcha_expiration: 901, admin_ui_excluded: true });
	assert.equal(res.status, 400, res.text);
	assert.equal(await conf(), previous);
	assert.deepEqual(await includes(), previousIncludes);
	assert.equal((await settings()).captcha_expiration, 7200);
});

it("refuses invalid bodies and keeps the settings", async () => {
	const previous = await conf();
	const bodies = {
		"unknown field": { extra: 1 },
		"unknown mode": { mode: "fast" },
		"URL with a space": { api_url: "http://a b:8080" },
		"URL with a user": { api_url: "http://user:pw@lapi:8080" },
		"value with #": { scenarios_containing: "http-#" },
		"value with a line break": { captcha_site_key: "a\nENABLED=true" },
		"page outside /data/crowdsec": { ban_template_path: "/etc/passwd" },
		"page with ..": { ban_template_path: "/data/crowdsec/../npmpro/database.sqlite" },
		"status code not in the bouncer's table": { ret_code: 418 },
		"excluded path without /": { exclude_location: "health" },
		"captcha without keys": { captcha_provider: "turnstile" },
		"status answer without a code": { ban_response: "status", ret_code: null },
		"timeout out of range": { request_timeout: 5 },
	};
	for (const [label, body] of Object.entries(bodies)) {
		const res = await admin.put("/settings/crowdsec", body);
		assert.equal(res.status, 400, `${label}: ${res.text}`);
	}
	assert.equal(await conf(), previous);
});

it("leaves the admin UI out of CrowdSec", async () => {
	const res = await admin.put("/settings/crowdsec", { admin_ui_excluded: true });
	assert.equal(res.status, 200, res.text);
	assert.equal(await api.read("/data/npmpro/nginx/crowdsec-admin.conf"), "set $npmpro_crowdsec_skip 1;\n");
	await admin.put("/settings/crowdsec", { admin_ui_excluded: false });
	assert.equal(
		await api.read("/data/npmpro/nginx/crowdsec-admin.conf"),
		"# the admin UI is checked by CrowdSec (Settings, CrowdSec)\n",
	);
});

it("tests unsaved values with the saved key and changes nothing", async () => {
	await admin.put("/settings/crowdsec", { api_key: KEY });
	const calls = reloads(api);
	const ok = await admin.post("/settings/crowdsec/test", { api_url: lapiUrl, appsec_url: "" });
	assert.equal(ok.status, 200, ok.text);
	assert.deepEqual(ok.body, { ok: true, checks: [{ name: "lapi", result: "ok", message: "" }] });
	const wrong = await admin.post("/settings/crowdsec/test", { api_url: lapiUrl, appsec_url: "", api_key: "nope" });
	assert.equal(wrong.body.checks[0].result, "key_refused");
	assert.equal(reloads(api), calls);
	assert.equal((await settings()).api_url, lapiUrl);
});

it("previews the ban and captcha pages", async () => {
	const ban = await admin.get("/settings/crowdsec/preview/ban");
	assert.equal(ban.status, 200);
	assert.match(ban.headers.get("content-type"), /^text\/html/u);
	assert.equal(ban.text, BAN_PAGE);
	assert.equal((await admin.get("/settings/crowdsec/preview/captcha")).text, "<p>captcha</p>");
	assert.equal((await admin.get("/settings/crowdsec/preview/other")).status, 404);
});

it("names only the settings that really changed, not a secret the environment sets", async () => {
	await admin.put("/settings/crowdsec", { mode: "live", cache_expiration: 5 });
	await admin.put("/settings/crowdsec", { mode: "live", cache_expiration: 5, captcha_secret_key: null });
	assert.deepEqual((await lastAudit()).changed, []);
});

it("tells a missing key apart from a refused one and never answers 401 or 403 for a bad key", async () => {
	await admin.put("/settings/crowdsec", { api_key: null, enabled: false });
	const hits = lapiHits;
	const none = await admin.post("/settings/crowdsec/test", { api_url: lapiUrl, appsec_url: "" });
	assert.equal(none.status, 200, none.text);
	assert.deepEqual(none.body, {
		ok: false,
		checks: [{ name: "lapi", result: "no_key", message: "No API key is set" }],
	});
	assert.equal(lapiHits, hits);
	const refused = await admin.post("/settings/crowdsec/test", { api_url: lapiUrl, appsec_url: "", api_key: "bad" });
	assert.equal(refused.status, 200, refused.text);
	assert.equal(refused.body.checks[0].result, "key_refused");
	const put = await admin.put("/settings/crowdsec", { enabled: true, api_url: lapiUrl, api_key: "bad" });
	assert.equal(put.status, 409, put.text);
	await admin.put("/settings/crowdsec", { api_key: KEY });
});
