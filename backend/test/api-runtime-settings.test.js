import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { fileExists, reloads } from "./support/hosts.js";

// /settings/runtime/{group} (schema/paths/settings/runtime, wiki/Configuration): six groups whose save is applied
// (files, nginx -t, reload) before it is stored.

const BASE = "/settings/runtime";
const GROUPS = ["certificates", "network", "nginx", "forward-auth", "logs", "advanced"];
const NGINX_FILES = ["main", "events", "http", "stream"].map((part) => `data/npmpro/nginx/core-${part}.conf`);
const ACME = "https://acme-v02.api.letsencrypt.org";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

let api;
let admin;
let hosts = 0;

const get = async (group) => {
	const done = await admin.get(`${BASE}/${group}`);
	assert.equal(done.status, 200, done.text);
	return done.body;
};
const put = (group, body, session = admin) => session.put(`${BASE}/${group}`, body);
const saved = async (group, body) => {
	const done = await put(group, body);
	assert.equal(done.status, 200, done.text);
	return done.body;
};
const storedMeta = async (group) => {
	const row = await api.db("setting").where({ id: group }).first();
	if (!row) return null;
	return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
};
const refused = async (group, body, pattern) => {
	const done = await put(group, body);
	assert.equal(done.status, 400, `${JSON.stringify(body)}: ${done.text}`);
	if (pattern) assert.match(done.body.error.message, pattern);
	return done.body.error.message;
};
// nginx -t of the fake fails while a file holds the marker
const refuseWhile = (file, marker) =>
	api.outside.hookCommand(
		"nginx",
		`#!/bin/sh\nif grep -q '${marker}' "${api.root}/${file}" 2>/dev/null; then echo "nginx: [emerg] refused" >&2; exit 1; fi\n`,
	);
const nginxOk = () => api.outside.hookCommand("nginx", "#!/bin/sh\nexit 0\n");
const addProxyHost = async (extra) => {
	hosts += 1;
	const done = await admin.post("/nginx/proxy-hosts", {
		domain_names: [`rt${hosts}.example.com`],
		forward_scheme: "http",
		forward_host: `10.0.4.${hosts}`,
		forward_port: 8080,
		...extra,
	});
	assert.equal(done.status, 201, done.text);
	return done.body;
};
const addCustomCertificate = async (provider = "other") => {
	const [id] = await api.db("certificate").insert({
		owner_user_id: 1,
		created_on: "2026-01-01 00:00:00",
		modified_on: "2026-01-01 00:00:00",
		provider,
		nice_name: `${provider} certificate`,
		domain_names: JSON.stringify(["default.example.com"]),
		expires_on: "2099-01-01 00:00:00",
		meta: "{}",
	});
	return id;
};

before(async () => {
	// the beautifier and Gravatar are on unless a test turns them off; two values are locked by the environment
	api = await startApi({
		env: {
			// what envs.sh exports when the user set neither (NPMPRO_USER_ENV lists the names the user set)
			DISABLE_GRAVATAR: "false",
			DISABLE_NGINX_BEAUTIFIER: "false",
			TZ: "UTC",
			NPMPRO_USER_ENV: "NGINX_WORKER_CONNECTIONS AUTH_REQUEST_TINYAUTH_UPSTREAM",
			NGINX_WORKER_CONNECTIONS: "2048",
			AUTH_REQUEST_TINYAUTH_UPSTREAM: "http://tinyauth.lan:3000",
		},
	});
	admin = await api.admin();
});
after(() => api?.stop());

it("answers an unknown group with 404 on GET and PUT", async () => {
	for (const group of ["nope", "oidc", "monitoring", "geoip", "default-site", "traffic-state", "Network"]) {
		assert.equal((await admin.get(`${BASE}/${group}`)).status, 404, `GET ${group}`);
		assert.equal((await admin.put(`${BASE}/${group}`, { trust_cloudflare: true })).status, 404, `PUT ${group}`);
	}
});

it("shows every group with its values, locks, restart state and when a change applies", async () => {
	for (const group of GROUPS) {
		const view = await get(group);
		for (const key of ["locked", "locked_by", "locked_reason", "restart_pending", "applies"]) {
			assert.ok(key in view, `${group} has ${key}`);
		}
		assert.ok(Array.isArray(view.locked));
	}
	const certificates = await get("certificates");
	assert.equal(certificates.key_type, "ecdsa");
	assert.equal(certificates.key_size, "secp384r1");
	assert.equal(certificates.renewal_interval, 3);
	assert.equal(certificates.default_certificate_id, 0);
	assert.equal(certificates.applies.key_type, "next-certificate");
	assert.equal(certificates.applies.renewal_interval, "immediately");
	assert.equal(certificates.applies.ocsp_stapling, "reload");
	const network = await get("network");
	assert.deepEqual(network.trusted_ips, []);
	assert.equal(network.trust_cloudflare, false);
	const nginx = await get("nginx");
	assert.ok(nginx.cpu_count >= 1);
	assert.equal(nginx.tls12, true);
	assert.equal(nginx.worker_shutdown_timeout, "1h");
	const advanced = await get("advanced");
	assert.ok(advanced.time_zones.includes("UTC"));
	assert.equal(advanced.config_beautifier, true);
	assert.equal(advanced.gravatar, true);
	assert.equal(advanced.applies.time_zone, "restart");
	assert.equal((await get("logs")).applies.goaccess, "restart");
});

it("hides the groups from the generic settings routes, which refuse to change them", async () => {
	await saved("network", { trusted_ips: ["10.9.0.0/16"] });
	assert.ok(await storedMeta("network"));
	const listed = (await admin.get("/settings")).body.map((row) => row.id);
	for (const group of GROUPS) assert.equal(listed.includes(group), false, group);
	for (const group of GROUPS) {
		assert.equal((await admin.get(`/settings/${group}`)).status, 404, `GET ${group}`);
		const changed = await admin.put(`/settings/${group}`, { value: "404" });
		assert.equal(changed.status, 400, `PUT ${group}`);
	}
	assert.deepEqual((await storedMeta("network")).trusted_ips, ["10.9.0.0/16"]);
	await saved("network", { trusted_ips: [] });
});

it("writes the trusted IPs to ip_ranges.conf, reloads nginx and audits the save", async () => {
	const calls = reloads(api);
	const view = await saved("network", { trusted_ips: ["192.168.0.0/16", "fd00::/8", "203.0.113.7"] });
	assert.deepEqual(view.trusted_ips, ["192.168.0.0/16", "fd00::/8", "203.0.113.7"]);
	const conf = await api.read("usr/local/nginx/conf/conf.d/ip_ranges.conf");
	for (const range of ["192.168.0.0/16", "fd00::/8", "203.0.113.7"]) {
		assert.match(conf, new RegExp(`set_real_ip_from\\s+${range.replaceAll(".", "\\.")};`, "u"));
	}
	assert.equal(reloads(api), calls + 1);
	assert.deepEqual((await get("network")).trusted_ips, ["192.168.0.0/16", "fd00::/8", "203.0.113.7"]);
	assert.deepEqual((await storedMeta("network")).trusted_ips, ["192.168.0.0/16", "fd00::/8", "203.0.113.7"]);
	const audit = await api.db("audit_log").where({ object_type: "setting" }).orderBy("id", "desc").first();
	assert.equal(audit.action, "updated");
	assert.equal(JSON.parse(audit.meta).id, "network");

	const cleared = await saved("network", { trusted_ips: [] });
	assert.deepEqual(cleared.trusted_ips, []);
	assert.doesNotMatch(await api.read("usr/local/nginx/conf/conf.d/ip_ranges.conf"), /203\.0\.113\.7/u);
});

it("refuses invalid network values with 400 and changes nothing", async () => {
	const conf = await api.read("usr/local/nginx/conf/conf.d/ip_ranges.conf");
	const calls = reloads(api);
	await refused("network", { trusted_ips: ["not-an-ip"] }, /not an IPv4\/IPv6 address/u);
	await refused("network", { trusted_ips: ["10.0.0.0/33"] });
	await refused("network", { trusted_ips: ["fd00::/129"] });
	await refused("network", { trusted_ips: ["10.0.0.1; deny all"] });
	await refused("network", { trusted_ips: [""] });
	await refused("network", { trusted_ips: "10.0.0.1" });
	await refused("network", { trust_cloudflare: "yes" });
	await refused("network", {});
	await refused("network", { extra: true });
	assert.equal(await api.read("usr/local/nginx/conf/conf.d/ip_ranges.conf"), conf);
	assert.equal(reloads(api), calls);
	assert.equal((await get("network")).trusted_ips.length, 0);
});

it("fetches the Cloudflare ranges when Cloudflare is trusted, and refuses the save when they can not be fetched", async () => {
	const cloudflare = api.outside.http.get("https://www.cloudflare.com");
	cloudflare.intercept({ path: "/ips-v4", method: "GET" }).reply(200, "173.245.48.0/20\n103.21.244.0/22\n");
	cloudflare.intercept({ path: "/ips-v6", method: "GET" }).reply(200, "2400:cb00::/32\n");
	const view = await saved("network", { trust_cloudflare: true });
	assert.equal(view.trust_cloudflare, true);
	const conf = await api.read("usr/local/nginx/conf/conf.d/ip_ranges.conf");
	assert.match(conf, /set_real_ip_from\s+173\.245\.48\.0\/20;/u);
	assert.match(conf, /set_real_ip_from\s+2400:cb00::\/32;/u);
	assert.equal(await saved("network", { trust_cloudflare: false }).then((body) => body.trust_cloudflare), false);
	assert.doesNotMatch(await api.read("usr/local/nginx/conf/conf.d/ip_ranges.conf"), /173\.245/u);

	api.outside.http.get("https://www.cloudflare.com").intercept({ path: "/ips-v4", method: "GET" }).reply(503, "down");
	api.outside.http.get("https://www.cloudflare.com").intercept({ path: "/ips-v6", method: "GET" }).reply(503, "down");
	await refused("network", { trust_cloudflare: true }, /Cloudflare/u);
	assert.equal((await get("network")).trust_cloudflare, false);
	assert.equal((await storedMeta("network")).trust_cloudflare, false);
});

it("writes the four nginx core files on save and reloads once", async () => {
	const calls = reloads(api);
	const view = await saved("nginx", {
		worker_processes: "1",
		worker_shutdown_timeout: "30s",
		tls12: false,
		log_not_found: true,
		module_njs: true,
	});
	assert.equal(view.worker_processes, "1");
	assert.equal(view.tls12, false);
	const [main, events, http, stream] = await Promise.all(NGINX_FILES.map((file) => api.read(file)));
	assert.match(main, /worker_processes 1;/u);
	assert.match(main, /worker_shutdown_timeout 30s;/u);
	assert.match(main, /load_module modules\/ngx_http_js_module\.so;/u);
	assert.match(http, /log_not_found on;/u);
	assert.match(http, /ssl_protocols TLSv1\.3;/u);
	assert.match(stream, /ssl_protocols TLSv1\.3;/u);
	assert.match(http, /js_engine qjs;/u);
	// worker_connections is locked by the environment (2048), so events holds that value
	assert.match(events, /worker_connections 2048;/u);
	assert.equal(reloads(api), calls + 1);

	const back = await saved("nginx", { tls12: true, module_njs: false, log_not_found: false });
	assert.equal(back.tls12, true);
	assert.match(await api.read(NGINX_FILES[2]), /ssl_protocols TLSv1\.2 TLSv1\.3;/u);
	assert.doesNotMatch(await api.read(NGINX_FILES[0]), /ngx_http_js_module/u);
});

it("post-quantum only turns TLS 1.2 and the NIST P curves off in the files, and keeps the stored switches", async () => {
	await saved("nginx", { tls12: true, secp_curves: true });
	const view = await saved("nginx", { force_mlkem: true });
	assert.equal(view.force_mlkem, true);
	assert.ok(view.locked.includes("tls12"));
	assert.ok(view.locked.includes("secp_curves"));
	assert.equal(view.locked_reason.tls12, "force-mlkem-setting");
	const http = await api.read(NGINX_FILES[2]);
	assert.match(http, /ssl_protocols TLSv1\.3;/u);
	assert.match(http, /ssl_ecdh_curve X25519MLKEM768;/u);
	const stored = await storedMeta("nginx");
	assert.equal(stored.tls12, true);
	assert.equal(stored.secp_curves, true);
	await saved("nginx", { force_mlkem: false });
	assert.match(await api.read(NGINX_FILES[2]), /ssl_protocols TLSv1\.2 TLSv1\.3;/u);
});

it("refuses invalid nginx values with 400", async () => {
	const files = await Promise.all(NGINX_FILES.map((file) => api.read(file)));
	await refused("nginx", { worker_processes: "0" }, /worker_processes/u);
	await refused("nginx", { worker_processes: "9999" }, /worker_processes/u);
	await refused("nginx", { worker_processes: "many" }, /worker_processes/u);
	await refused("nginx", { worker_shutdown_timeout: "1x" }, /worker_shutdown_timeout/u);
	await refused("nginx", { worker_shutdown_timeout: "1m1h" }, /worker_shutdown_timeout/u);
	await refused("nginx", { worker_shutdown_timeout: "" });
	await refused("nginx", { log_not_found: "on" });
	await refused("nginx", { module_unknown: true });
	await refused("nginx", {});
	assert.deepEqual(await Promise.all(NGINX_FILES.map((file) => api.read(file))), files);
});

it("ignores a value the environment sets, and says so in locked and locked_by", async () => {
	const view = await get("nginx");
	assert.ok(view.locked.includes("worker_connections"));
	assert.equal(view.locked_by.worker_connections, "NGINX_WORKER_CONNECTIONS");
	assert.equal(view.worker_connections, 2048);
	const calls = reloads(api);
	const ignored = await saved("nginx", { worker_connections: 100 });
	assert.equal(ignored.worker_connections, 2048);
	assert.equal(reloads(api), calls);
	assert.equal((await storedMeta("nginx"))?.worker_connections, undefined);
	// a body with a locked and a free field keeps only the free one
	const mixed = await saved("nginx", { worker_connections: 100, worker_shutdown_timeout: "2m" });
	assert.equal(mixed.worker_connections, 2048);
	assert.equal(mixed.worker_shutdown_timeout, "2m");
	assert.equal((await storedMeta("nginx")).worker_connections, undefined);
	assert.match(await api.read(NGINX_FILES[1]), /worker_connections 2048;/u);
	await saved("nginx", { worker_shutdown_timeout: "1h" });
});

it("keeps the old value, files and reload count when nginx -t refuses a save", async () => {
	const before_ = await get("nginx");
	const files = await Promise.all(NGINX_FILES.map((file) => api.read(file)));
	const calls = reloads(api);
	await refuseWhile(NGINX_FILES[0], "worker_processes auto;");
	try {
		const message = await refused("nginx", { worker_processes: "auto" }, /refused/u);
		assert.match(message, /nginx/u);
	} finally {
		await nginxOk();
	}
	assert.equal((await get("nginx")).worker_processes, before_.worker_processes);
	assert.deepEqual(await Promise.all(NGINX_FILES.map((file) => api.read(file))), files);
	assert.equal(reloads(api), calls);
	assert.equal((await storedMeta("nginx")).worker_processes, "1");
	const afterwards = await saved("nginx", { worker_processes: "auto" });
	assert.equal(afterwards.worker_processes, "auto");
});

it("keeps the old value and files when the nginx reload fails", async () => {
	const files = await Promise.all(NGINX_FILES.map((file) => api.read(file)));
	api.outside.control.failNext = "reload broke";
	await refused("nginx", { worker_shutdown_timeout: "5m" });
	assert.deepEqual(await Promise.all(NGINX_FILES.map((file) => api.read(file))), files);
	assert.equal((await get("nginx")).worker_shutdown_timeout, "1h");
});

it("writes the ACME client settings for the next certificate, and checks the key size against the key type", async () => {
	const view = await saved("certificates", { key_type: "rsa", key_size: "2048", must_staple: false, profile: "" });
	assert.equal(view.key_type, "rsa");
	assert.equal(view.key_size, "2048");
	const ini = await api.read("run/npmpro/certbot.ini");
	assert.match(ini, /key-type = rsa/u);
	assert.match(ini, /rsa-key-size = 2048/u);
	await refused("certificates", { key_size: "secp384r1" }, /key_size/u);
	await refused("certificates", { key_type: "dsa" }, /key_type/u);
	// a stored size that no longer fits falls back to the default of the new type
	const ecdsa = await saved("certificates", { key_type: "ecdsa" });
	assert.equal(ecdsa.key_size, "secp384r1");
	assert.match(await api.read("run/npmpro/certbot.ini"), /elliptic-curve = secp384r1/u);
	const both = await saved("certificates", { key_type: "rsa", key_size: "3072" });
	assert.equal(both.key_size, "3072");
	await saved("certificates", { key_type: "ecdsa", key_size: "secp256r1" });
});

it("checks an ACME profile with the ACME server before it saves it", async () => {
	const directory = (body, status = 200) =>
		api.outside.http.get(ACME).intercept({ path: "/directory", method: "GET" }).reply(status, body);
	directory({ newNonce: `${ACME}/nonce`, meta: { profiles: { classic: "classic", tlsserver: "tls" } } });
	const view = await saved("certificates", { profile: "tlsserver" });
	assert.equal(view.profile, "tlsserver");
	assert.equal((await storedMeta("certificates")).profile, "tlsserver");

	directory({ newNonce: `${ACME}/nonce`, meta: { profiles: { classic: "classic" } } });
	await refused("certificates", { profile: "shortlived" }, /does not offer this profile/u);
	directory("down", 503);
	await refused("certificates", { profile: "classic" }, /Could not check the ACME server profiles/u);
	await refused("certificates", { profile: "bad profile!" }, /profile/u);
	assert.equal((await get("certificates")).profile, "tlsserver");
	await saved("certificates", { profile: "" });
	assert.equal((await get("certificates")).profile, "");
});

it("takes the renewal and ECH intervals at once, and refuses values out of range", async () => {
	const view = await saved("certificates", { renewal_interval: 12, ech_rotation_interval: 6 });
	assert.equal(view.renewal_interval, 12);
	assert.equal(view.ech_rotation_interval, 6);
	for (const body of [
		{ renewal_interval: 0 },
		{ renewal_interval: 500 },
		{ renewal_interval: 1.5 },
		{ renewal_interval: "soon" },
		{ ech_rotation_interval: 25 },
		{ ech_rotation_interval: 0 },
	]) {
		await refused("certificates", body);
	}
	assert.equal((await get("certificates")).renewal_interval, 12);
	await saved("certificates", { renewal_interval: 3, ech_rotation_interval: 1 });
});

it("sets the default certificate in the default certificate include, and refuses missing and mTLS ones", async () => {
	const include = "data/npmpro/nginx/default-cert.conf";
	await refused("certificates", { default_certificate_id: 9999 }, /Certificate not found/u);
	const mtls = await addCustomCertificate("mtls");
	await refused("certificates", { default_certificate_id: mtls }, /mTLS/u);
	const id = await addCustomCertificate();
	await refused("certificates", { default_certificate_id: id }, /files are missing/u);
	await refused("certificates", { default_certificate_id: -1 });
	assert.equal((await get("certificates")).default_certificate_id, 0);

	const folder = `${api.root}/data/tls/custom/npm-${id}`;
	await mkdir(folder, { recursive: true });
	await writeFile(`${folder}/fullchain.pem`, "cert");
	await writeFile(`${folder}/privkey.pem`, "key");
	const calls = reloads(api);
	const view = await saved("certificates", { default_certificate_id: id });
	assert.equal(view.default_certificate_id, id);
	assert.match(await api.read(include), new RegExp(`/data/tls/custom/npm-${id}/fullchain\\.pem`, "u"));
	assert.equal(reloads(api), calls + 1);

	// nginx refusing the include keeps the built-in one and the stored id
	const second = await addCustomCertificate();
	const secondFolder = `${api.root}/data/tls/custom/npm-${second}`;
	await mkdir(secondFolder, { recursive: true });
	await writeFile(`${secondFolder}/fullchain.pem`, "cert");
	await writeFile(`${secondFolder}/privkey.pem`, "key");
	await refuseWhile(include, `npm-${second}/`);
	try {
		await refused("certificates", { default_certificate_id: second }, /refused/u);
	} finally {
		await nginxOk();
	}
	assert.equal((await get("certificates")).default_certificate_id, id);
	assert.match(await api.read(include), new RegExp(`npm-${id}/`, "u"));

	await saved("certificates", { default_certificate_id: 0 });
	assert.doesNotMatch(await api.read(include), /npm-\d+/u);
});

it("re-renders the proxy hosts that use a forward authentication provider when its default upstream changes", async () => {
	const host = await addProxyHost({ npmpro_auth_request: "anubis" });
	const confFile = `data/nginx/proxy_host/${host.id}.conf`;
	assert.equal(await fileExists(api, confFile), true);
	const view = await saved("forward-auth", { anubis_upstream: "http://anubis.lan:8923" });
	assert.equal(view.anubis_upstream, "http://anubis.lan:8923");
	assert.match(await api.read(confFile), /anubis\.lan:8923/u);

	const changed = await saved("forward-auth", { anubis_upstream: "http://anubis2.lan:9000" });
	assert.equal(changed.anubis_upstream, "http://anubis2.lan:9000");
	const config = await api.read(confFile);
	assert.match(config, /anubis2\.lan:9000/u);
	assert.doesNotMatch(config, /anubis\.lan:8923/u);

	// a host with its own upstream and a host that does not use the provider are not touched
	const other = await addProxyHost({});
	const otherConf = await api.read(`data/nginx/proxy_host/${other.id}.conf`);
	await saved("forward-auth", { anubis_upstream: "http://anubis3.lan:9001" });
	assert.equal(await api.read(`data/nginx/proxy_host/${other.id}.conf`), otherConf);
});

it("refuses to clear a default upstream that proxy hosts still use, and invalid upstream values", async () => {
	const message = await refused("forward-auth", { anubis_upstream: "" }, /still used by proxy hosts/u);
	assert.match(message, /rt\d+\.example\.com/u);
	assert.equal((await get("forward-auth")).anubis_upstream, "http://anubis3.lan:9001");
	for (const upstream of [
		"http://anubis.lan",
		"http://anubis.lan:8923/path",
		"ftp://anubis.lan:21",
		"http://a b:80",
		"http://anubis.lan:80;",
		"anubis.lan:80",
		"http://x:80$y",
	]) {
		await refused("forward-auth", { authelia_upstream: upstream }, /authelia_upstream/u);
	}
	const named = await saved("forward-auth", { authelia_upstream: "http://cu_authelia" });
	assert.equal(named.authelia_upstream, "http://cu_authelia");
	await saved("forward-auth", { authelia_upstream: "" });
	// a provider nobody uses can be cleared
	assert.equal(
		(await saved("forward-auth", { voidauth_upstream: "http://v.lan:1" })).voidauth_upstream,
		"http://v.lan:1",
	);
	assert.equal((await saved("forward-auth", { voidauth_upstream: "" })).voidauth_upstream, "");
});

it("ignores a forward authentication upstream the environment sets", async () => {
	const view = await get("forward-auth");
	assert.equal(view.tinyauth_upstream, "http://tinyauth.lan:3000");
	assert.ok(view.locked.includes("tinyauth_upstream"));
	assert.equal(view.locked_by.tinyauth_upstream, "AUTH_REQUEST_TINYAUTH_UPSTREAM");
	const done = await saved("forward-auth", { tinyauth_upstream: "http://other.lan:1" });
	assert.equal(done.tinyauth_upstream, "http://tinyauth.lan:3000");
	assert.equal((await storedMeta("forward-auth")).tinyauth_upstream, undefined);
});

it("answers 401 without a session and 403 for a user who is not an administrator, on every group", async () => {
	const none = api.client();
	const user = await api.limited({ visibility: "all" });
	const before_ = await get("network");
	const bodies = {
		certificates: { renewal_interval: 5 },
		network: { trusted_ips: ["10.1.1.1"] },
		nginx: { worker_shutdown_timeout: "9m" },
		"forward-auth": { voidauth_upstream: "http://v.lan:1" },
		logs: { log_rotations: 9 },
		advanced: { gravatar: false },
	};
	for (const group of GROUPS) {
		for (const [method, body] of [["get"], ["put", bodies[group]]]) {
			assert.equal((await none[method](`${BASE}/${group}`, body)).status, 401, `${method} ${group}`);
			assert.equal((await user[method](`${BASE}/${group}`, body)).status, 403, `${method} ${group}`);
		}
	}
	assert.deepEqual((await get("network")).trusted_ips, before_.trusted_ips);
});

it("turns the log files on: creates them with mode 0600, writes the includes and reloads nginx", async () => {
	const calls = reloads(api);
	const view = await saved("logs", { write_log_files: true });
	assert.equal(view.write_log_files, true);
	assert.equal(await api.read("data/npmpro/nginx/error-log.conf"), "error_log /data/nginx/logs/error.log warn;\n");
	assert.equal(await api.read("data/npmpro/nginx/stream-log.conf"), "access_log /data/nginx/logs/stream.log slog;\n");
	assert.equal(await api.read("data/npmpro/nginx/access-log.conf"), "access_log /data/nginx/logs/access.log alog;\n");
	for (const name of ["access.log", "error.log", "stream.log"]) {
		const info = await stat(`${api.root}/data/nginx/logs/${name}`);
		assert.equal(info.mode & 0o777, 0o600, name);
		assert.equal(await fileExists(api, `data/nginx/${name}`), true, `link ${name}`);
	}
	assert.equal(reloads(api), calls + 1);

	await saved("logs", { write_log_files: false });
	assert.equal(await api.read("data/npmpro/nginx/error-log.conf"), "# no error log file, errors go to stderr\n");
	assert.equal(await api.read("data/npmpro/nginx/stream-log.conf"), "access_log off;\n");
	assert.equal(await api.read("data/npmpro/nginx/access-log.conf"), "access_log off;\n");
});

it("keeps the log includes when nginx refuses the new ones", async () => {
	const include = "data/npmpro/nginx/error-log.conf";
	const old = await api.read(include);
	await refuseWhile(include, "error.log warn");
	try {
		await refused("logs", { write_log_files: true }, /refused/u);
	} finally {
		await nginxOk();
	}
	assert.equal(await api.read(include), old);
	assert.equal((await get("logs")).write_log_files, false);
	assert.equal((await storedMeta("logs")).write_log_files, false);
});

it("sets the number of log rotations in the live logrotate config", async () => {
	await mkdir(`${api.root}/run/npmpro`, { recursive: true });
	await writeFile(`${api.root}/run/npmpro/logrotate`, "/data/nginx/logs/*.log {\n  daily\n  rotate 3\n}\n");
	const view = await saved("logs", { log_rotations: 14 });
	assert.equal(view.log_rotations, 14);
	assert.match(await api.read("run/npmpro/logrotate"), /^\s+rotate 14$/mu);
	for (const body of [
		{ log_rotations: 0 },
		{ log_rotations: 1001 },
		{ log_rotations: -1 },
		{ log_rotations: "many" },
	]) {
		await refused("logs", body);
	}
	assert.match(await api.read("run/npmpro/logrotate"), /^\s+rotate 14$/mu);
});

it("writes the GoAccess and time zone settings to the startup settings file for the next start", async () => {
	const file = "data/npmpro/startup-settings.env";
	const view = await saved("logs", {
		goaccess: true,
		goaccess_keep_days: 60,
		goaccess_anonymize: "2",
		goaccess_drop_query_strings: false,
	});
	assert.equal(view.goaccess, true);
	assert.ok(view.restart_pending.includes("goaccess"));
	const settings = await api.read(file);
	assert.match(settings, /^GOA=true$/mu);
	assert.match(settings, /^goaccess_keep_days=60$/mu);
	assert.match(settings, /^goaccess_anonymize=2$/mu);
	assert.match(settings, /^goaccess_drop_query_strings=false$/mu);

	const zone = await saved("advanced", { time_zone: "Europe/Berlin" });
	assert.equal(zone.time_zone, "Europe/Berlin");
	assert.ok(zone.restart_pending.includes("time_zone"));
	assert.match(await api.read(file), /^TZ=Europe\/Berlin$/mu);
	assert.match(await api.read(file), /^GOA=true$/mu);

	for (const body of [
		{ goaccess_keep_days: 0 },
		{ goaccess_keep_days: 367 },
		{ goaccess_anonymize: "9" },
		{ goaccess: "maybe" },
	]) {
		await refused("logs", body);
	}
	await refused("advanced", { time_zone: "Mars/Olympus" }, /time zone/u);
	await refused("advanced", { time_zone: "" });
	assert.match(await api.read(file), /^TZ=Europe\/Berlin$/mu);
	await saved("logs", { goaccess: false });
	assert.match(await api.read(file), /^GOA=false$/mu);
	await saved("advanced", { time_zone: "UTC" });
});

// the formatter is the nginxbeautifier module of the image; without it (a developer machine) the text stays as rendered
const BEAUTIFIER_MODULE = "/usr/local/bin/nginxbeautifier.js";

it("turning the beautifier off changes the next config", async () => {
	const host = await addProxyHost({});
	const confFile = `data/nginx/proxy_host/${host.id}.conf`;
	const resave = async (port) => {
		const done = await admin.put(`/nginx/proxy-hosts/${host.id}`, { forward_port: port });
		assert.equal(done.status, 200, done.text);
		return api.read(confFile);
	};
	const formatted = await resave(8181);

	const off = await saved("advanced", { config_beautifier: false });
	assert.equal(off.config_beautifier, false);
	assert.equal((await storedMeta("advanced")).config_beautifier, false);
	const plain = await resave(8182);
	assert.match(plain, /8182/u);

	const on = await saved("advanced", { config_beautifier: true });
	assert.equal(on.config_beautifier, true);
	const again = await resave(8182);
	assert.match(again, /8182/u);
	if (existsSync(BEAUTIFIER_MODULE)) {
		assert.notEqual(again, plain);
		assert.equal(again.split("\n").filter((line) => line !== "" && line.trim() === "").length, 0);
		assert.equal(formatted.split("\n").filter((line) => line !== "" && line.trim() === "").length, 0);
		assert.ok(plain.split("\n").some((line) => line !== "" && line.trim() === ""));
	}
});

it("turning Gravatar off sends no request at the next profile save", async () => {
	const requests = [];
	const gravatar = api.outside.http.get("https://www.gravatar.com");
	gravatar
		.intercept({ path: /^\/avatar\//u, method: "GET" })
		.reply(200, () => {
			requests.push(1);
			return PNG;
		})
		.persist();
	const create = async (name) => {
		const done = await admin.post("/users", {
			name,
			email: `${name.replaceAll(" ", "")}@example.com`,
			roles: [],
			auth: { type: "password", secret: "correct-horse-battery-9" },
		});
		assert.equal(done.status, 201, done.text);
		return done.body;
	};

	assert.equal((await get("advanced")).gravatar, true);
	const on = await create("Gravatar On");
	assert.equal(requests.length, 1);
	assert.match(on.avatar, /^\/images\/gravatar\/\d+\.png/u);

	const off = await saved("advanced", { gravatar: false });
	assert.equal(off.gravatar, false);
	const second = await create("Gravatar Off");
	assert.equal(requests.length, 1);
	assert.equal(second.avatar, "/images/default-avatar.jpg");
	// the profile save of the first user takes the default picture too
	const resaved = await admin.put(`/users/${on.id}`, { name: "Gravatar On Renamed" });
	assert.equal(resaved.status, 200, resaved.text);
	assert.equal(requests.length, 1);
	assert.equal(resaved.body.avatar, "/images/default-avatar.jpg");
	await saved("advanced", { gravatar: true });
});
