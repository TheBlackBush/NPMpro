import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { fileExists } from "./support/hosts.js";

// LISTEN_PROXY_PROTOCOL_HTTPS: a failed handshake is logged before nginx reads the PROXY header, so a handshake line
// names the load balancer; the TLS handshake log stays off and no save or CrowdSec turn-on writes its include
const TLS_OFF = "# no TLS handshake log (Settings, Logs & monitoring)\n";
const INCLUDE = "data/npmpro/nginx/tls-log.conf";

let api;
let admin;
before(async () => {
	api = await startApi({
		env: { LISTEN_PROXY_PROTOCOL_HTTPS: "true", LISTEN_PROXY_PROTOCOL_HTTP: "false", TZ: "UTC" },
	});
	admin = await api.admin();
});
after(() => api?.stop());

const logs = async () => {
	const res = await admin.get("/settings/runtime/logs");
	assert.equal(res.status, 200, res.text);
	return res.body;
};

it("shows the TLS handshake log locked off by LISTEN_PROXY_PROTOCOL_HTTPS, with its reason", async () => {
	const view = await logs();
	assert.equal(view.tls_handshake_log, false);
	assert.ok(view.locked.includes("tls_handshake_log"));
	assert.equal(view.locked_by.tls_handshake_log, "LISTEN_PROXY_PROTOCOL_HTTPS");
	assert.equal(view.locked_reason.tls_handshake_log, "proxy-protocol");
});

it("a save with the TLS handshake log on keeps it off and writes the comment", async () => {
	const res = await admin.put("/settings/runtime/logs", { write_log_files: true, tls_handshake_log: true });
	assert.equal(res.status, 200, res.text);
	assert.equal(res.body.write_log_files, true);
	assert.equal(res.body.tls_handshake_log, false);
	assert.equal(await api.read(INCLUDE), TLS_OFF);
	assert.equal(await fileExists(api, "data/nginx/logs/tls.log"), false);
	await admin.put("/settings/runtime/logs", { write_log_files: false });
	assert.equal(await api.read(INCLUDE), TLS_OFF);
});

it("CrowdSec turning the log files on writes the comment, also with a stored TLS handshake log", async () => {
	// stored before the PROXY protocol was turned on
	const row = await api.db("setting").where({ id: "logs" }).first();
	const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
	await api
		.db("setting")
		.where({ id: "logs" })
		.update({ meta: JSON.stringify({ ...meta, write_log_files: false, tls_handshake_log: true }) });
	const res = await admin.put("/settings/crowdsec", {
		enabled: true,
		api_url: "http://127.0.0.1:9",
		api_key: "unused-key",
		force: true,
	});
	assert.equal(res.status, 200, res.text);
	assert.notEqual(await api.read("data/npmpro/nginx/error-log.conf"), "# no error log file, errors go to stderr\n");
	assert.equal(await api.read(INCLUDE), TLS_OFF);
	assert.equal(await fileExists(api, "data/nginx/logs/tls.log"), false);
	assert.equal((await admin.put("/settings/crowdsec", { enabled: false })).status, 200);
});

it("lists the lock on the Environment page", async () => {
	const res = await admin.get("/settings/environment");
	assert.equal(res.status, 200, res.text);
	assert.deepEqual(
		res.body.locked_runtime.find((entry) => entry.key === "tls_handshake_log"),
		{ group: "logs", key: "tls_handshake_log", env: "LISTEN_PROXY_PROTOCOL_HTTPS", reason: "proxy-protocol" },
	);
});
