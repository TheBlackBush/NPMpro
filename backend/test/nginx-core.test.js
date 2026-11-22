import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
	affinityOf,
	cpuAffinityMask,
	parseCpuList,
	readCpusAllowed,
	renderNginxCore,
	resolverLine,
} from "../lib/nginx-core.js";

const DEFAULTS = {
	worker_processes: "4",
	worker_connections: 512,
	worker_shutdown_timeout: "1h",
	cpu_affinity: "off",
	log_not_found: false,
	tls12: true,
	force_mlkem: false,
	secp_curves: true,
	rsa_pkcs1: false,
	module_njs: false,
	module_ldap: false,
	module_ntlm: false,
	module_vts: false,
	resolver_addresses: [],
	resolver_hosts: true,
	resolver_ipv6: true,
	resolver_valid: "",
};
const SIGALGS =
	"mldsa87:mldsa65:mldsa44:ed25519:ecdsa_secp521r1_sha512:ecdsa_secp384r1_sha384:ecdsa_secp256r1_sha256:rsa_pss_rsae_sha512:rsa_pss_rsae_sha384:rsa_pss_rsae_sha256";
const NONE_ALLOWED = /none of the CPUs 0-3 is allowed/u;
const UNREADABLE = /cannot be read/u;
const TRIM_KEPT = /could not cut the affinity line of .*core-main\.conf, it is kept as it is/u;
const ALLOWED_LIST = /Cpus_allowed_list:\t(?<list>\S+)/u;
const lines = (text) => text.split("\n").filter((line) => line && !line.startsWith("#"));

it("renders today's nginx.conf values for the defaults", () => {
	const out = renderNginxCore(DEFAULTS);
	assert.deepEqual(lines(out.main), ["worker_processes 4;", "worker_shutdown_timeout 1h;"]);
	assert.deepEqual(lines(out.events), []);
	assert.ok(out.events.startsWith("# written by NPMpro"));
	assert.deepEqual(lines(out.http), [
		"log_not_found off;",
		"ssl_protocols TLSv1.2 TLSv1.3;",
		"ssl_ecdh_curve X25519MLKEM768:x25519:secp521r1:secp384r1:prime256v1;",
		`ssl_sigalgs ${SIGALGS};`,
	]);
	assert.deepEqual(lines(out.stream), lines(out.http).slice(1));
});

it("renders today's resolver line for the defaults", () => {
	assert.deepEqual(lines(renderNginxCore(DEFAULTS).resolver), ["resolver local=on hosts=on ipv6=on;"]);
	assert.ok(renderNginxCore(DEFAULTS).resolver.startsWith("# written by NPMpro"));
	assert.equal(resolverLine(DEFAULTS), "resolver local=on hosts=on ipv6=on;");
});

it("renders addresses, hosts off, ipv6 off and valid", () => {
	const render = (extra) => lines(renderNginxCore({ ...DEFAULTS, ...extra }).resolver);
	assert.deepEqual(render({ resolver_addresses: ["1.1.1.1", "[2606:4700::1111]:53"] }), [
		"resolver 1.1.1.1 [2606:4700::1111]:53 hosts=on ipv6=on;",
	]);
	assert.deepEqual(
		render({ resolver_addresses: ["1.1.1.1"], resolver_hosts: false, resolver_ipv6: false, resolver_valid: "30s" }),
		["resolver 1.1.1.1 hosts=off ipv6=off valid=30s;"],
	);
	assert.deepEqual(render({ resolver_valid: "5m" }), ["resolver local=on hosts=on ipv6=on valid=5m;"]);
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

it("parses CPU lists and builds the affinity mask, CPU 0 right-most", () => {
	assert.deepEqual([...parseCpuList("16,18,20")], [16, 18, 20]);
	assert.equal(cpuAffinityMask(parseCpuList("0-1,3")), "1011");
	assert.equal(cpuAffinityMask(parseCpuList("5")), "100000");
	assert.equal(cpuAffinityMask(parseCpuList("16-23")), `11111111${"0".repeat(16)}`);
	assert.equal(cpuAffinityMask(parseCpuList("0-3,8-11")), "111100001111");
	assert.equal(cpuAffinityMask(new Set()), null);
	for (const bad of ["", "3-1", "a-b", "1,,2", "0-1024", " 1", "1 ,2", "-1"])
		assert.equal(parseCpuList(bad), null, bad);
	assert.equal(parseCpuList(5), null);
});

it("reads Cpus_allowed_list", () => {
	const status = "Name:\tnode\nCpus_allowed:\tff0000\nCpus_allowed_list:\t16-23\n";
	assert.equal(readCpusAllowed({ readText: () => status }), "16-23");
	assert.equal(readCpusAllowed({ readText: () => "Name:\tnode\n" }), null);
	assert.equal(readCpusAllowed({ readText: () => null }), null);
	assert.equal(readCpusAllowed({ statusFile: "/nonexistent/status" }), null);
	assert.equal(affinityOf("off", null).note, null);
});

it("writes the affinity line for auto and custom lists, cut to the allowed CPUs", () => {
	const mainOf = (setting, cpusAllowed) => renderNginxCore({ ...DEFAULTS, cpu_affinity: setting }, { cpusAllowed });
	const second = (out) => lines(out.main)[1];
	assert.equal(mainOf("off", "16-23").main.includes("affinity"), false);
	assert.equal(second(mainOf("auto", "16-23")), `worker_cpu_affinity auto 11111111${"0".repeat(16)};`);
	assert.equal(second(mainOf("16,18,20", "16-23")), `worker_cpu_affinity auto 10101${"0".repeat(16)};`);
	// cut to the allowed CPUs: 15 is not allowed, 16 and 17 stay
	assert.equal(second(mainOf("15-17", "16-23")), `worker_cpu_affinity auto 11${"0".repeat(16)};`);
	const empty = mainOf("0-3", "16-23");
	assert.equal(empty.main.includes("affinity"), false);
	assert.match(empty.affinityNote, NONE_ALLOWED);
	const unreadable = mainOf("auto", null);
	assert.equal(unreadable.main.includes("affinity"), false);
	assert.match(unreadable.affinityNote, UNREADABLE);
	assert.equal(mainOf("off", null).affinityNote, null);
});

// the shell twin (data-setup.sh at the first start) writes what the backend writes for the same values
const SCRIPT = path.join(import.meta.dirname, "../../rootfs/usr/local/bin/nginx-core-files.sh");
// the note goes to stderr; statusText is the status file (none when null)
const shellRun = (env, statusText = null) => {
	const dir = mkdtempSync(path.join(tmpdir(), "nginx-core-"));
	const status = path.join(dir, "status");
	if (statusText !== null) writeFileSync(status, statusText);
	const result = spawnSync("sh", [SCRIPT, dir], {
		env: { PATH: process.env.PATH, NPMPRO_PROC_STATUS: status, ...env },
		encoding: "utf8",
	});
	if (result.status !== 0) throw new Error(result.stderr);
	const read = (name) => readFileSync(path.join(dir, `core-${name}.conf`), "utf8");
	const files = { main: read("main"), events: read("events"), http: read("http"), stream: read("stream") };
	return { files, note: result.stderr.trim() || null };
};
const shellFiles = (env, statusText) => shellRun(env, statusText).files;
// the renderer's files without the note
// (resolver.conf is written by the shell twin from the next task on)
const renderedFiles = (values, options) => {
	const { affinityNote, resolver, ...files } = renderNginxCore(values, options);
	return files;
};
// envs.sh exports (defaults filled in, the force rule applied)
const ENVS = {
	NGINX_WORKER_PROCESSES: "4",
	NGINX_WORKER_CONNECTIONS: "512",
	NGINX_WORKER_SHUTDOWN_TIMEOUT: "1h",
	NGINX_CPU_AFFINITY: "off",
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
	assert.deepEqual(shellFiles(ENVS), renderedFiles(DEFAULTS, { cpusAllowed: null }));
	const variant = {
		...ENVS,
		NGINX_WORKER_PROCESSES: "auto",
		NGINX_WORKER_CONNECTIONS: "4096",
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
		renderedFiles({
			worker_processes: "auto",
			worker_connections: 4096,
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

it("the shell twin matches the renderer for every affinity mode", () => {
	const allowed = (list) => `Name:\tnode\nCpus_allowed_list:\t${list}\n`;
	const cases = [
		["off", allowed("16-23")],
		["auto", allowed("16-23")],
		["16,18,20", allowed("16-23")],
		["15-17", allowed("16-23")],
		["0-3", allowed("16-23")],
		["auto", "Name:\tnode\n"],
		["auto", null],
		["auto", allowed("0-3,8-11")],
		["2,9-10,12", allowed("0-3,8-11")],
		["3-1", allowed("0-3")],
	];
	for (const [setting, status] of cases) {
		const { files, note } = shellRun({ ...ENVS, NGINX_CPU_AFFINITY: setting }, status);
		const cpusAllowed = status?.match(ALLOWED_LIST)?.groups.list ?? null;
		const options = { cpusAllowed };
		assert.deepEqual(
			files,
			renderedFiles({ ...DEFAULTS, cpu_affinity: setting }, options),
			`${setting} ${cpusAllowed}`,
		);
		assert.equal(note, renderNginxCore({ ...DEFAULTS, cpu_affinity: setting }, options).affinityNote, setting);
	}
});

// data-setup.sh runs the script with --if-missing: files the backend wrote (with the modules of the last apply) stay
const NAMES = ["main", "events", "http", "stream"].map((name) => `core-${name}.conf`);
const ifMissing = (dir) =>
	execFileSync("sh", [SCRIPT, "--if-missing", dir], { env: { PATH: process.env.PATH, ...ENVS } });

it("--if-missing keeps the files when all four exist", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "nginx-core-"));
	for (const name of NAMES) {
		writeFileSync(path.join(dir, name), `# kept ${name}\n`);
	}
	writeFileSync(
		path.join(dir, "core-main.conf"),
		"worker_processes 2;\nload_module modules/ngx_http_js_module.so;\n",
	);
	ifMissing(dir);
	assert.equal(
		readFileSync(path.join(dir, "core-main.conf"), "utf8"),
		"worker_processes 2;\nload_module modules/ngx_http_js_module.so;\n",
	);
	for (const name of NAMES.slice(1)) {
		assert.equal(readFileSync(path.join(dir, name), "utf8"), `# kept ${name}\n`);
	}
});

it("--if-missing writes all four files when one is missing", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "nginx-core-"));
	for (const name of NAMES) {
		writeFileSync(path.join(dir, name), "# old\n");
	}
	rmSync(path.join(dir, "core-stream.conf"));
	ifMissing(dir);
	const expected = renderNginxCore(DEFAULTS);
	assert.ok(existsSync(path.join(dir, "core-stream.conf")));
	assert.equal(readFileSync(path.join(dir, "core-stream.conf"), "utf8"), expected.stream);
	assert.equal(readFileSync(path.join(dir, "core-main.conf"), "utf8"), expected.main);
});

// data-setup.sh also runs --trim-affinity: a mask kept from another CPU set must not name a CPU outside the allowed ones
const trimAffinity = (mainText, allowed) => {
	const dir = mkdtempSync(path.join(tmpdir(), "nginx-core-"));
	const status = path.join(dir, "status");
	writeFileSync(status, allowed === null ? "Name:\tnginx\n" : `Cpus_allowed_list:\t${allowed}\n`);
	writeFileSync(path.join(dir, "core-main.conf"), mainText);
	execFileSync("sh", [SCRIPT, "--trim-affinity", dir], {
		env: { PATH: process.env.PATH, NPMPRO_PROC_STATUS: status, ...ENVS },
	});
	return readFileSync(path.join(dir, "core-main.conf"), "utf8");
};
const MAIN_4_7 = "# header\nworker_processes auto;\nworker_cpu_affinity auto 11110000;\nworker_shutdown_timeout 5;\n";

it("--trim-affinity cuts a stale mask to the allowed CPUs and drops it when none is left", () => {
	assert.equal(trimAffinity(MAIN_4_7, "4-7"), MAIN_4_7);
	assert.equal(
		trimAffinity(MAIN_4_7, "5-6"),
		"# header\nworker_processes auto;\nworker_cpu_affinity auto 1100000;\nworker_shutdown_timeout 5;\n",
	);
	assert.equal(trimAffinity(MAIN_4_7, "0-3"), "# header\nworker_processes auto;\nworker_shutdown_timeout 5;\n");
	assert.equal(trimAffinity(MAIN_4_7, null), "# header\nworker_processes auto;\nworker_shutdown_timeout 5;\n");
	const noLine = "# header\nworker_processes auto;\n";
	assert.equal(trimAffinity(noLine, "0-3"), noLine);
});

it("--trim-affinity keeps core-main.conf as it is when the cut copy cannot be written", {
	skip: process.getuid?.() === 0,
}, () => {
	// the folder is not writable (the file is): neither the cut nor the drop may empty the file
	for (const allowed of ["5-6", "0-3"]) {
		const dir = mkdtempSync(path.join(tmpdir(), "nginx-core-"));
		const status = path.join(dir, "status");
		writeFileSync(status, `Cpus_allowed_list:\t${allowed}\n`);
		writeFileSync(path.join(dir, "core-main.conf"), MAIN_4_7);
		chmodSync(dir, 0o555);
		try {
			const result = spawnSync("sh", [SCRIPT, "--trim-affinity", dir], {
				env: { PATH: process.env.PATH, NPMPRO_PROC_STATUS: status, ...ENVS },
				encoding: "utf8",
			});
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, TRIM_KEPT);
			assert.equal(readFileSync(path.join(dir, "core-main.conf"), "utf8"), MAIN_4_7);
		} finally {
			chmodSync(dir, 0o755);
		}
	}
});

it("--trim-affinity leaves a missing core-main.conf alone", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "nginx-core-"));
	execFileSync("sh", [SCRIPT, "--trim-affinity", dir], { env: { PATH: process.env.PATH, ...ENVS } });
	assert.equal(existsSync(path.join(dir, "core-main.conf")), false);
});
