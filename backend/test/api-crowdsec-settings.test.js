import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { fileExists, reloads } from "./support/hosts.js";

const KEY = "good-key-0123456789";
const CONF_ON = /^ENABLED=true$/mu;
const CONF_OFF = /^ENABLED=false$/mu;
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

it("refuses even a forced save that would lock the admin UI out, and allows the other forced saves", async () => {
	const appsec = http.createServer((req, res) => {
		res.writeHead(req.headers["x-crowdsec-appsec-api-key"] === KEY ? 200 : 401);
		res.end("{}");
	});
	await new Promise((resolve) => appsec.listen(0, "127.0.0.1", resolve));
	const appsecUrl = `http://127.0.0.1:${appsec.address().port}`;
	const body = {
		enabled: true,
		api_url: lapiUrl,
		api_key: KEY,
		appsec_url: appsecUrl,
		appsec_failure_action: "deny",
	};
	try {
		await admin.put("/settings/crowdsec", { enabled: false });
		const confBefore = await conf();
		const calls = reloads(api);
		const refused = await admin.put("/settings/crowdsec", { ...body, api_key: "wrong-key-secret", force: true });
		assert.equal(refused.status, 409, refused.text);
		assert.equal(refused.body.error.message_i18n, "error.crowdsec-test-failed");
		assert.equal(refused.body.error.force_blocked, "appsec_deny_admin");
		assert.equal(refused.text.includes("wrong-key-secret"), false);
		assert.equal((await settings()).enabled, false);
		assert.equal(await conf(), confBefore);
		assert.equal(reloads(api), calls);

		// the refused test without force names the block too
		const unforced = await admin.put("/settings/crowdsec", { ...body, api_key: "wrong-key-secret" });
		assert.equal(unforced.status, 409, unforced.text);
		assert.equal(unforced.body.error.force_blocked, "appsec_deny_admin");

		// a failing LAPI alone (AppSec takes the key) stays forceable
		const lapiOnly = await admin.put("/settings/crowdsec", { ...body, api_url: "http://127.0.0.1:9" });
		assert.equal(lapiOnly.status, 409, lapiOnly.text);
		assert.equal(lapiOnly.body.error.force_blocked, undefined);
		const forcedLapi = await admin.put("/settings/crowdsec", {
			...body,
			api_url: "http://127.0.0.1:9",
			force: true,
		});
		assert.equal(forcedLapi.status, 200, forcedLapi.text);
		await admin.put("/settings/crowdsec", { enabled: false });

		// passthrough and a left-out admin UI are never a lockout
		const passthrough = await admin.put("/settings/crowdsec", {
			...body,
			api_key: "wrong-key-secret",
			appsec_failure_action: "passthrough",
			force: true,
		});
		assert.equal(passthrough.status, 200, passthrough.text);
		await admin.put("/settings/crowdsec", { enabled: false });
		const excluded = await admin.put("/settings/crowdsec", {
			...body,
			api_key: "wrong-key-secret",
			admin_ui: "out",
			force: true,
		});
		assert.equal(excluded.status, 200, excluded.text);
		const bansOnly = await admin.put("/settings/crowdsec", {
			...body,
			api_key: "wrong-key-secret",
			admin_ui: "bans",
			force: true,
		});
		assert.equal(bansOnly.status, 200, bansOnly.text);
	} finally {
		await admin.put("/settings/crowdsec", {
			enabled: false,
			appsec_url: "",
			appsec_failure_action: "deny",
			admin_ui: "checked",
		});
		await new Promise((resolve) => appsec.close(resolve));
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
	// admin_ui changes the admin include, so its rollback is seen too
	const res = await admin.put("/settings/crowdsec", { captcha_expiration: 901, admin_ui: "bans" });
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

it("refuses AppSec without an API key with TLS authentication, also with force", async () => {
	const previous = await conf();
	const body = {
		enabled: true,
		api_url: "https://lapi.invalid:8080",
		use_tls_auth: true,
		tls_client_cert: "/data/crowdsec/c.crt",
		tls_client_key: "/data/crowdsec/c.key",
		appsec_url: "http://appsec.invalid:7422",
		api_key: null,
	};
	for (const force of [false, true]) {
		const res = await admin.put("/settings/crowdsec", { ...body, force });
		assert.equal(res.status, 400, res.text);
		assert.match(res.text, /AppSec uses the API key of the bouncer/u);
	}
	assert.equal(await conf(), previous);
});

it("writes the admin include for each choice", async () => {
	const expected = {
		bans: "set $crowdsec_disable_appsec 1;\n",
		out: "set $npmpro_crowdsec_skip 1;\n",
		checked: "# the admin UI is checked by CrowdSec (Settings, CrowdSec)\n",
	};
	for (const choice of ["bans", "out", "checked"]) {
		const res = await admin.put("/settings/crowdsec", { admin_ui: choice });
		assert.equal(res.status, 200, res.text);
		assert.equal(await api.read("/data/npmpro/nginx/crowdsec-admin.conf"), expected[choice]);
		const current = await settings();
		assert.equal(current.admin_ui, choice);
		assert.equal(Object.hasOwn(current, "admin_ui_excluded"), false);
	}
});

it("keeps an old row's switch on a save of another field", async () => {
	const first = await api.db("setting").where({ id: "crowdsec" }).first();
	const meta = typeof first.meta === "string" ? JSON.parse(first.meta) : first.meta;
	const stored = async () => {
		const now = await api.db("setting").where({ id: "crowdsec" }).first();
		return typeof now.meta === "string" ? JSON.parse(now.meta) : now.meta;
	};
	const { admin_ui: _dropped, ...rest } = meta;
	await api
		.db("setting")
		.where({ id: "crowdsec" })
		.update({ meta: JSON.stringify({ ...rest, admin_ui_excluded: true }) });
	try {
		assert.equal((await settings()).admin_ui, "bans");
		const res = await admin.put("/settings/crowdsec", { captcha_expiration: 902 });
		assert.equal(res.status, 200, res.text);
		assert.equal(await api.read("/data/npmpro/nginx/crowdsec-admin.conf"), "set $crowdsec_disable_appsec 1;\n");
		const row = await stored();
		assert.equal(row.admin_ui, "bans");
		assert.equal(Object.hasOwn(row, "admin_ui_excluded"), false);
	} finally {
		await admin.put("/settings/crowdsec", { captcha_expiration: 7200, admin_ui: "checked" });
	}
});

it("refuses the old switch and an unknown choice in a PUT", async () => {
	const saved = await settings();
	const include = await api.read("/data/npmpro/nginx/crowdsec-admin.conf");
	assert.equal((await admin.put("/settings/crowdsec", { admin_ui_excluded: true })).status, 400);
	assert.equal((await admin.put("/settings/crowdsec", { admin_ui: "all" })).status, 400);
	assert.equal(await api.read("/data/npmpro/nginx/crowdsec-admin.conf"), include);
	assert.deepEqual(await settings(), saved);
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

it("keeps both changes of two saves that overlap", async () => {
	// a slow LAPI holds the first save in its connection test while the second one (forced, no test) is applied
	let release;
	const held = new Promise((resolve) => {
		release = resolve;
	});
	let asked;
	const testing = new Promise((resolve) => {
		asked = resolve;
	});
	const slow = http.createServer(async (_req, res) => {
		asked();
		await held;
		res.writeHead(200, { "content-type": "application/json" });
		res.end("null");
	});
	await new Promise((resolve) => slow.listen(0, "127.0.0.1", resolve));
	const slowUrl = `http://127.0.0.1:${slow.address().port}`;
	try {
		assert.equal((await settings()).enabled, false);
		const first = admin.put("/settings/crowdsec", {
			enabled: true,
			api_url: slowUrl,
			api_key: KEY,
			appsec_url: "",
			captcha_expiration: 1111,
		});
		await testing;
		const second = await admin.put("/settings/crowdsec", { update_frequency: 33, force: true });
		assert.equal(second.status, 200, second.text);
		release();
		const done = await first;
		assert.equal(done.status, 200, done.text);
		const now = await settings();
		assert.equal(now.enabled, true);
		assert.equal(now.captcha_expiration, 1111);
		assert.equal(now.update_frequency, 33);
		assert.match(await conf(), /^UPDATE_FREQUENCY=33$/mu);
		assert.match(await conf(), /^CAPTCHA_EXPIRATION=1111$/mu);
	} finally {
		release();
		await admin.put("/settings/crowdsec", { enabled: false });
		await new Promise((resolve) => slow.close(resolve));
	}
});

it("restores a backup without secrets with the bouncer off while AppSec has no key, and a save with the key turns it on", async () => {
	const appsec = http.createServer((req, res) => {
		res.writeHead(req.headers["x-crowdsec-appsec-api-key"] === KEY ? 200 : 401);
		res.end("{}");
	});
	await new Promise((resolve) => appsec.listen(0, "127.0.0.1", resolve));
	const appsecUrl = `http://127.0.0.1:${appsec.address().port}`;
	const bouncerOn = "include /usr/local/nginx/conf/crowdsec-bouncer.conf;\n";
	const bouncerOff = "# the CrowdSec bouncer is off (Settings, CrowdSec)\n";
	try {
		const body = {
			enabled: true,
			api_url: lapiUrl,
			api_key: KEY,
			appsec_url: appsecUrl,
			appsec_failure_action: "deny",
		};
		const saved = await admin.put("/settings/crowdsec", body);
		assert.equal(saved.status, 200, saved.text);
		assert.equal(await api.read("/data/npmpro/nginx/crowdsec.conf"), bouncerOn);
		const made = await admin.post("/backups", { types: ["settings_crowdsec"], secrets: false, keep: true });
		assert.equal(made.status, 200, made.text);
		const opened = await admin.post(`/backups/${made.body.entry.name}/inspect`, {});
		assert.equal(opened.status, 200, opened.text);
		const restored = await admin.post(`/backups/restore/${opened.body.token}`, {
			types: ["settings_crowdsec"],
			confirm: true,
		});
		assert.equal(restored.status, 200, restored.text);
		// the row keeps the restored settings (on, the AppSec URL) without the key; the include leaves the bouncer off
		const after = await settings();
		assert.equal(after.enabled, true);
		assert.equal(after.appsec_url, appsecUrl);
		assert.equal(after.api_key_set, false);
		assert.equal(await api.read("/data/npmpro/nginx/crowdsec.conf"), bouncerOff);
		const keyed = await admin.put("/settings/crowdsec", { api_key: KEY });
		assert.equal(keyed.status, 200, keyed.text);
		assert.equal(await api.read("/data/npmpro/nginx/crowdsec.conf"), bouncerOn);
	} finally {
		await admin.put("/settings/crowdsec", { enabled: false, appsec_url: "" });
		await new Promise((resolve) => appsec.close(resolve));
	}
});

const ERROR_ON = "error_log /data/nginx/logs/error.log warn;\n";
const ERROR_OFF = "# no error log file, errors go to stderr\n";
const TLS_OFF = "# no TLS handshake log (Settings, Logs & monitoring)\n";
const includeOf = (name) => api.read(`/data/npmpro/nginx/${name}`);
const WORKING = () => ({ enabled: true, api_url: lapiUrl, api_key: KEY, force: true });

// CrowdSec off and Write log files off with the includes on their off lines, whatever the earlier tests left
const logsOff = async () => {
	await admin.put("/settings/crowdsec", { enabled: false });
	await admin.put("/settings/runtime/logs", { write_log_files: true });
	await admin.put("/settings/runtime/logs", { write_log_files: false });
};

it("a save that turns CrowdSec on writes the log includes and locks Write log files; off keeps the includes", async () => {
	await logsOff();
	assert.equal(await includeOf("error-log.conf"), ERROR_OFF);

	const saved = await admin.put("/settings/crowdsec", WORKING());
	assert.equal(saved.status, 200, saved.text);
	assert.equal(await includeOf("error-log.conf"), ERROR_ON);
	assert.equal(await includeOf("stream-log.conf"), "access_log /data/nginx/logs/stream.log slog;\n");
	assert.equal(await includeOf("access-log.conf"), "access_log /data/nginx/logs/access.log alog;\n");
	assert.equal(await api.read("/data/nginx/logs/access.log"), "");
	const logs = (await admin.get("/settings/runtime/logs")).body;
	assert.equal(logs.write_log_files, true);
	assert.deepEqual(logs.locked_reason, { write_log_files: "crowdsec-setting" });

	assert.equal((await admin.put("/settings/crowdsec", { enabled: false })).status, 200);
	assert.equal(await includeOf("error-log.conf"), ERROR_ON);
	const unlocked = (await admin.get("/settings/runtime/logs")).body;
	assert.equal(unlocked.write_log_files, false);
	assert.deepEqual(unlocked.locked, []);
});

it("a CrowdSec save with a stored json log format writes ajson and sjson", async () => {
	await logsOff();
	assert.equal((await admin.put("/settings/runtime/logs", { log_format: "json" })).status, 200);
	try {
		const saved = await admin.put("/settings/crowdsec", WORKING());
		assert.equal(saved.status, 200, saved.text);
		assert.equal(await includeOf("error-log.conf"), ERROR_ON);
		assert.equal(await includeOf("stream-log.conf"), "access_log /data/nginx/logs/stream.log sjson;\n");
		assert.equal(await includeOf("access-log.conf"), "access_log /data/nginx/logs/access.log ajson;\n");
	} finally {
		assert.equal((await admin.put("/settings/runtime/logs", { log_format: "classic" })).status, 200);
	}
	await logsOff();
});

it("a CrowdSec save with a stored TLS handshake log and the log files off writes tls-log.conf on", async () => {
	await logsOff();
	assert.equal(
		(await admin.put("/settings/runtime/logs", { write_log_files: true, tls_handshake_log: true })).status,
		200,
	);
	assert.equal((await admin.put("/settings/runtime/logs", { write_log_files: false })).status, 200);
	try {
		assert.equal(await includeOf("tls-log.conf"), TLS_OFF);
		const saved = await admin.put("/settings/crowdsec", WORKING());
		assert.equal(saved.status, 200, saved.text);
		assert.equal(
			await includeOf("tls-log.conf"),
			"error_log stderr warn;\nerror_log /data/nginx/logs/error.log warn;\nerror_log /data/nginx/logs/tls.log info;\n",
		);
		assert.equal(await fileExists(api, "data/nginx/logs/tls.log"), true);

		// CrowdSec off writes nothing
		assert.equal((await admin.put("/settings/crowdsec", { enabled: false })).status, 200);
		assert.notEqual(await includeOf("tls-log.conf"), TLS_OFF);
	} finally {
		await admin.put("/settings/crowdsec", { enabled: false });
		await admin.put("/settings/runtime/logs", { write_log_files: true, tls_handshake_log: false });
	}
	await logsOff();
});

it("a CrowdSec save refused by nginx -t leaves the log includes on their off lines", async () => {
	await logsOff();
	assert.equal(await includeOf("error-log.conf"), ERROR_OFF);

	await api.outside.failCommand("nginx", "nginx: [emerg] lua error");
	try {
		const refused = await admin.put("/settings/crowdsec", WORKING());
		assert.equal(refused.status, 400, refused.text);
	} finally {
		await api.outside.passCommand("nginx");
	}
	assert.equal(await includeOf("error-log.conf"), ERROR_OFF);
	assert.equal((await settings()).enabled, false);
	const logs = (await admin.get("/settings/runtime/logs")).body;
	assert.deepEqual(logs.locked, []);
});

it("a restore that turns CrowdSec on writes the log includes", async () => {
	await logsOff();
	const saved = await admin.put("/settings/crowdsec", WORKING());
	assert.equal(saved.status, 200, saved.text);
	const made = await admin.post("/backups", { types: ["settings_crowdsec"], secrets: false, keep: true });
	assert.equal(made.status, 200, made.text);
	await logsOff();
	assert.equal(await includeOf("error-log.conf"), ERROR_OFF);

	const opened = await admin.post(`/backups/${made.body.entry.name}/inspect`, {});
	assert.equal(opened.status, 200, opened.text);
	const restored = await admin.post(`/backups/restore/${opened.body.token}`, {
		types: ["settings_crowdsec"],
		confirm: true,
	});
	assert.equal(restored.status, 200, restored.text);
	assert.equal((await settings()).enabled, true);
	assert.equal(await includeOf("error-log.conf"), ERROR_ON);
	assert.equal((await admin.get("/settings/runtime/logs")).body.write_log_files, true);
	await admin.put("/settings/crowdsec", { enabled: false });
});

// a start after the container ran with CROWDSEC_ENABLED=false and the variable was removed: the file on disk says off
const startWithConf = async (enabled) => {
	await writeFile(path.join(api.root, "data/crowdsec/crowdsec.conf"), `ENABLED=${enabled}\n`);
	const { prepareApp } = await import("../startup.js");
	await prepareApp({ background: false });
};

it("a start with CrowdSec stored on but off in the file on disk writes the log includes and locks Write log files", async () => {
	await logsOff();
	const saved = await admin.put("/settings/crowdsec", WORKING());
	assert.equal(saved.status, 200, saved.text);

	await startWithConf(false);
	assert.match(await conf(), CONF_ON);
	assert.equal(await includeOf("error-log.conf"), ERROR_ON);
	assert.equal(await includeOf("stream-log.conf"), "access_log /data/nginx/logs/stream.log slog;\n");
	assert.equal(await includeOf("access-log.conf"), "access_log /data/nginx/logs/access.log alog;\n");
	const logs = (await admin.get("/settings/runtime/logs")).body;
	assert.equal(logs.write_log_files, true);
	assert.deepEqual(logs.locked_reason, { write_log_files: "crowdsec-setting" });
});

it("a start with CrowdSec stored off but on in the file on disk unlocks Write log files", async () => {
	await logsOff();
	await startWithConf(true);
	assert.match(await conf(), CONF_OFF);
	const logs = (await admin.get("/settings/runtime/logs")).body;
	assert.equal(logs.write_log_files, false);
	assert.deepEqual(logs.locked, []);
});
