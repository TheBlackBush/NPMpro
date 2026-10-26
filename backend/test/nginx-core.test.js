import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { renderNginxCore } from "../lib/nginx-core.js";

const DEFAULTS = {
	worker_processes: "4",
	worker_connections: 512,
	worker_shutdown_timeout: "1h",
	log_not_found: false,
	tls12: true,
	force_mlkem: false,
	secp_curves: true,
	rsa_pkcs1: false,
	module_njs: false,
	module_ldap: false,
	module_ntlm: false,
	module_vts: false,
};
const SIGALGS =
	"mldsa87:mldsa65:mldsa44:ed25519:ecdsa_secp521r1_sha512:ecdsa_secp384r1_sha384:ecdsa_secp256r1_sha256:rsa_pss_rsae_sha512:rsa_pss_rsae_sha384:rsa_pss_rsae_sha256";
const lines = (text) => text.split("\n").filter((line) => line && !line.startsWith("#"));

it("renders today's nginx.conf values for the defaults", () => {
	const out = renderNginxCore(DEFAULTS);
	assert.deepEqual(lines(out.main), ["worker_processes 4;", "worker_shutdown_timeout 1h;"]);
	assert.deepEqual(lines(out.events), ["worker_connections 512;"]);
	assert.deepEqual(lines(out.http), [
		"log_not_found off;",
		"ssl_protocols TLSv1.2 TLSv1.3;",
		"ssl_ecdh_curve X25519MLKEM768:x25519:secp521r1:secp384r1:prime256v1;",
		`ssl_sigalgs ${SIGALGS};`,
	]);
	assert.deepEqual(lines(out.stream), lines(out.http).slice(1));
});

it("renders each setting", () => {
	const out = renderNginxCore({
		...DEFAULTS,
		worker_processes: "auto",
		worker_shutdown_timeout: "0",
		worker_connections: 4096,
		log_not_found: true,
		tls12: false,
		secp_curves: false,
		rsa_pkcs1: true,
		module_njs: true,
		module_vts: true,
	});
	assert.deepEqual(lines(out.main), [
		"worker_processes auto;",
		"load_module modules/ngx_http_js_module.so;",
		"load_module modules/ngx_stream_js_module.so;",
		"load_module modules/ngx_http_vhost_traffic_status_module.so;",
	]);
	assert.deepEqual(lines(out.events), ["worker_connections 4096;"]);
	assert.ok(out.http.includes("log_not_found on;"));
	assert.ok(out.http.includes("ssl_protocols TLSv1.3;"));
	assert.ok(out.http.includes("ssl_ecdh_curve X25519MLKEM768:x25519;"));
	assert.ok(out.http.includes(`ssl_sigalgs ${SIGALGS}:rsa_pkcs1_sha512:rsa_pkcs1_sha384:rsa_pkcs1_sha256;`));
	assert.ok(out.http.includes("js_engine qjs;"));
	assert.ok(out.stream.includes("js_engine qjs;"));
});

it("post-quantum only offers X25519MLKEM768", () => {
	const out = renderNginxCore({ ...DEFAULTS, force_mlkem: true, tls12: false, secp_curves: false });
	assert.ok(out.http.includes("ssl_ecdh_curve X25519MLKEM768;"));
	assert.ok(out.stream.includes("ssl_ecdh_curve X25519MLKEM768;"));
});

// the shell twin (data-setup.sh at the first start) writes what the backend writes for the same values
const SCRIPT = path.join(import.meta.dirname, "../../rootfs/usr/local/bin/nginx-core-files.sh");
const shellFiles = (env) => {
	const dir = mkdtempSync(path.join(tmpdir(), "nginx-core-"));
	execFileSync("sh", [SCRIPT, dir], { env: { PATH: process.env.PATH, ...env } });
	const read = (name) => readFileSync(path.join(dir, `core-${name}.conf`), "utf8");
	return { main: read("main"), events: read("events"), http: read("http"), stream: read("stream") };
};
// envs.sh exports (defaults filled in, the force rule applied)
const ENVS = {
	NGINX_WORKER_PROCESSES: "4",
	NGINX_WORKER_CONNECTIONS: "512",
	NGINX_WORKER_SHUTDOWN_TIMEOUT: "1h",
	NGINX_LOG_NOT_FOUND: "false",
	NGINX_FORCE_X25519MLKEM768: "false",
	NGINX_DISABLE_TLS12: "false",
	NGINX_TRUST_SECPR1: "true",
	NGINX_TRUST_RSA_PKCS1: "false",
	NGINX_LOAD_NJS_MODULE: "false",
	NGINX_LOAD_LDAP_MODULE: "false",
	NGINX_LOAD_NTLM_MODULE: "false",
	NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE: "false",
};

it("the shell twin matches the renderer", () => {
	assert.deepEqual(shellFiles(ENVS), renderNginxCore(DEFAULTS));
	const variant = {
		...ENVS,
		NGINX_WORKER_PROCESSES: "auto",
		NGINX_WORKER_SHUTDOWN_TIMEOUT: "0",
		NGINX_LOG_NOT_FOUND: "true",
		NGINX_FORCE_X25519MLKEM768: "true",
		NGINX_DISABLE_TLS12: "true",
		NGINX_TRUST_SECPR1: "false",
		NGINX_TRUST_RSA_PKCS1: "true",
		NGINX_LOAD_NJS_MODULE: "true",
		NGINX_LOAD_LDAP_MODULE: "true",
		NGINX_LOAD_NTLM_MODULE: "true",
		NGINX_LOAD_VHOST_TRAFFIC_STATUS_MODULE: "true",
	};
	assert.deepEqual(
		shellFiles(variant),
		renderNginxCore({
			worker_processes: "auto",
			worker_connections: 512,
			worker_shutdown_timeout: "0",
			log_not_found: true,
			tls12: false,
			force_mlkem: true,
			secp_curves: false,
			rsa_pkcs1: true,
			module_njs: true,
			module_ldap: true,
			module_ntlm: true,
			module_vts: true,
		}),
	);
});
