import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import {
	defaultCertificatePaths,
	hasStaplingFile,
	renderDefaultCertConf,
	stapledHost,
	staplingFileOf,
} from "../lib/default-cert.js";
import { createRuntimeConfig } from "../lib/runtime-config.js";
import { mergeRuntimeConfig } from "../lib/runtime-rules.js";
import utils from "../lib/utils.js";

const ROOT = path.join(import.meta.dirname, "../..");
const INCLUDE = "include /data/npmpro/nginx/default-cert.conf;";
const CERT_LINE = /ssl_certificate(?:_key)? /u;

/**
 * A /data/tls lookalike: certbot certificate 5 (with .der), custom certificate 6 (without .der), custom 7 with an
 * empty privkey, the built-in certificate
 */
const tlsTree = async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "default-cert-"));
	const tls = path.join(dir, "tls");
	for (const sub of ["certbot/live/npm-5", "custom/npm-6", "custom/npm-7"])
		await mkdir(path.join(tls, sub), { recursive: true });
	await writeFile(path.join(tls, "certbot/live/npm-5/fullchain.pem"), "chain");
	await writeFile(path.join(tls, "certbot/live/npm-5/privkey.pem"), "key");
	await writeFile(path.join(tls, "certbot/live/npm-5.der"), "der");
	await writeFile(path.join(tls, "custom/npm-6/fullchain.pem"), "chain");
	await writeFile(path.join(tls, "custom/npm-6/privkey.pem"), "key");
	await writeFile(path.join(tls, "custom/npm-7/fullchain.pem"), "chain");
	await writeFile(path.join(tls, "custom/npm-7/privkey.pem"), "");
	await writeFile(path.join(tls, "dummycert.pem"), "dummy");
	await writeFile(path.join(tls, "dummykey.pem"), "dummy");
	return { dir, tls };
};

const ALL = [5, 6, 7, 8].map((id) => ({ id }));

it("finds the certbot and custom certificate files with the start.sh rules", async () => {
	const { tls } = await tlsTree();
	const on = { acme: true, custom: true };
	assert.deepEqual(await defaultCertificatePaths(5, ALL, { tlsDir: tls, stapling: on }), {
		cert: `${tls}/certbot/live/npm-5/fullchain.pem`,
		key: `${tls}/certbot/live/npm-5/privkey.pem`,
		stapling: `${tls}/certbot/live/npm-5.der`,
	});
	assert.equal(
		(await defaultCertificatePaths(5, ALL, { tlsDir: tls, stapling: { acme: false, custom: true } })).stapling,
		null,
	);
	assert.deepEqual(await defaultCertificatePaths(6, ALL, { tlsDir: tls, stapling: on }), {
		cert: `${tls}/custom/npm-6/fullchain.pem`,
		key: `${tls}/custom/npm-6/privkey.pem`,
		stapling: null,
	});
	// empty privkey, no folder, built-in, deleted certificate
	assert.equal(await defaultCertificatePaths(7, ALL, { tlsDir: tls }), null);
	assert.equal(await defaultCertificatePaths(8, ALL, { tlsDir: tls }), null);
	assert.equal(await defaultCertificatePaths(0, ALL, { tlsDir: tls }), null);
	assert.equal(await defaultCertificatePaths(5, [{ id: 6 }], { tlsDir: tls }), null);
});

it("renders the include for a certificate, with stapling, and the built-in certificate", () => {
	assert.equal(
		renderDefaultCertConf({ cert: "/c.pem", key: "/k.pem", stapling: null }),
		"ssl_certificate /c.pem;\nssl_certificate_key /k.pem;\n",
	);
	assert.equal(
		renderDefaultCertConf({ cert: "/c.pem", key: "/k.pem", stapling: "/s.der" }),
		"ssl_certificate /c.pem;\nssl_certificate_key /k.pem;\nssl_stapling on;\nssl_stapling_verify on;\nssl_stapling_file /s.der;\nssl_certificate_compression off;\n",
	);
	assert.equal(
		renderDefaultCertConf(null),
		"ssl_certificate /data/tls/dummycert.pem;\nssl_certificate_key /data/tls/dummykey.pem;\n",
	);
});

it("picks the hosts a stapling change affects", () => {
	const le = { certificate_id: 1, certificate: { provider: "letsencrypt" } };
	const custom = { certificate_id: 2, certificate: { provider: "other" } };
	const none = { certificate_id: 0, certificate: null };
	assert.deepEqual(
		[le, custom, none].map((host) => stapledHost(host, ["ocsp_stapling"])),
		[true, false, false],
	);
	assert.deepEqual(
		[le, custom, none].map((host) => stapledHost(host, ["custom_ocsp_stapling"])),
		[false, true, false],
	);
	assert.equal(stapledHost(le, ["default_certificate_id"]), false);
});

// start.sh's default certificate block, run with sh on a temp /data
const startShDefaultCert = async () => {
	const lines = (await readFile(path.join(ROOT, "rootfs/usr/local/bin/start.sh"), "utf8")).split("\n");
	const start = lines.indexOf('if [ "$DEFAULT_CERT_ID" = "0" ]; then');
	const end = lines.indexOf("} > /data/npmpro/nginx/default-cert.conf");
	if (start < 0 || end < start) throw new Error("default certificate block not found in start.sh");
	return lines.slice(start, end + 1).join("\n");
};

it("renders what start.sh writes for the same env (env DEFAULT_CERT_ID keeps today's output)", async () => {
	const script = await startShDefaultCert();
	const cases = [
		{ DEFAULT_CERT_ID: "0" },
		{ DEFAULT_CERT_ID: "5", ACME_OCSP_STAPLING: "true" },
		{ DEFAULT_CERT_ID: "5", ACME_OCSP_STAPLING: "false" },
		{ DEFAULT_CERT_ID: "6", CUSTOM_OCSP_STAPLING: "true" },
		{ DEFAULT_CERT_ID: "7" },
		{ DEFAULT_CERT_ID: "8" },
	];
	for (const overrides of cases) {
		const { dir, tls } = await tlsTree();
		const env = { ACME_OCSP_STAPLING: "false", CUSTOM_OCSP_STAPLING: "false", ...overrides };
		const local = script.replaceAll("/data/tls", tls).replaceAll("/data/npmpro", path.join(dir, "npmpro"));
		execFileSync("sh", ["-c", local], { env: { PATH: process.env.PATH, ...env }, stdio: "ignore" });
		const fromStartSh = await readFile(path.join(dir, "npmpro/nginx/default-cert.conf"), "utf8");

		const { values } = mergeRuntimeConfig("certificates", {}, env);
		const files = await defaultCertificatePaths(values.default_certificate_id, ALL, {
			tlsDir: tls,
			stapling: { acme: values.ocsp_stapling, custom: values.custom_ocsp_stapling },
		});
		assert.equal(renderDefaultCertConf(files, tls), fromStartSh, JSON.stringify(overrides));
	}
});

it("keeps the default certificate out of default.conf and npmpro.conf, start.sh no longer edits them", async () => {
	const startSh = await readFile(path.join(ROOT, "rootfs/usr/local/bin/start.sh"), "utf8");
	assert.equal(startSh.includes("ssl_certificate .*"), false);
	assert.equal(startSh.includes("ssl_stapling"), true);
	const npmproConf = await readFile(path.join(ROOT, "rootfs/usr/local/nginx/conf/conf.d/npmpro.conf"), "utf8");
	assert.ok(npmproConf.includes(`  ${INCLUDE}\n`));
	assert.equal(CERT_LINE.test(npmproConf), false);

	const template = await readFile(path.join(import.meta.dirname, "../templates/default.conf"), "utf8");
	for (const value of ["congratulations", "404", "redirect", "html", "444"]) {
		const out = await utils
			.getRenderEngine()
			.parseAndRender(template, { value, meta: { redirect: "https://example.com" }, env: {} });
		assert.equal(out.includes(INCLUDE), value !== "444", value);
		assert.equal(CERT_LINE.test(out), false, value);
	}
});

it("renders host stapling from the effective values, an env value wins", async () => {
	const template = await readFile(path.join(import.meta.dirname, "../templates/proxy_host.conf"), "utf8");
	const host = (env) => ({
		id: 3,
		enabled: true,
		certificate_id: 5,
		certificate: { provider: "letsencrypt" },
		domain_names: ["a.example"],
		server_names: ["a.example"],
		forward_scheme: "http",
		forward_host: "backend",
		forward_port: 80,
		npmpro_stapling_file_exists: true,
		env,
	});
	const render = async (env) => utils.getRenderEngine().parseAndRender(template, host(env));
	const staplingLine = "ssl_stapling_file /data/tls/certbot/live/npm-5.der;";
	const quiet = { warn: () => {} };

	// envs.sh default (not set by the user) and a stored true: stapling on
	const boot = { ACME_OCSP_STAPLING: "false", NPMPRO_USER_ENV: "" };
	const stored = createRuntimeConfig({ env: boot, readStored: async () => ({ ocsp_stapling: true }), log: quiet });
	await stored.loadRuntimeConfig();
	assert.ok((await render(stored.effectiveEnv())).includes(staplingLine));
	// the values an apply passes before the save
	const next = { ...(await stored.getRuntimeConfig("certificates")).values, ocsp_stapling: false };
	assert.equal((await render(stored.effectiveEnv({ certificates: next }))).includes(staplingLine), false);

	// set by the user: env wins over the stored value
	const locked = { ACME_OCSP_STAPLING: "false", NPMPRO_USER_ENV: "ACME_OCSP_STAPLING" };
	const envWins = createRuntimeConfig({ env: locked, readStored: async () => ({ ocsp_stapling: true }), log: quiet });
	await envWins.loadRuntimeConfig();
	assert.equal((await render(envWins.effectiveEnv())).includes(staplingLine), false);
});

it("finds the OCSP response file of a host's certificate", async () => {
	const { tls } = await tlsTree();
	const le = { certificate_id: 5, certificate: { provider: "letsencrypt" } };
	const custom = { certificate_id: 6, certificate: { provider: "other" } };
	assert.deepEqual(staplingFileOf(le, tls), {
		file: `${tls}/certbot/live/npm-5.der`,
		kind: "acme",
		env: "ACME_OCSP_STAPLING",
	});
	assert.equal(staplingFileOf(custom, tls).kind, "custom");
	assert.equal(staplingFileOf({ certificate_id: 0, certificate: null }), null);
	assert.equal(await hasStaplingFile(le, { tlsDir: tls }), true);
	assert.equal(await hasStaplingFile(custom, { tlsDir: tls }), false);
});

it("host templates staple only when the OCSP response file exists", async () => {
	const render = async (name, host) =>
		utils
			.getRenderEngine()
			.parseAndRender(await readFile(path.join(import.meta.dirname, `../templates/${name}.conf`), "utf8"), host);
	const env = { ACME_OCSP_STAPLING: "true", CUSTOM_OCSP_STAPLING: "true" };
	const cases = [
		["proxy_host", "letsencrypt", "ssl_stapling_file /data/tls/certbot/live/npm-5.der;"],
		["proxy_host", "other", "ssl_stapling_file /data/tls/custom/npm-5.der;"],
		["redirection_host", "letsencrypt", "ssl_stapling_file /data/tls/certbot/live/npm-5.der;"],
		["dead_host", "other", "ssl_stapling_file /data/tls/custom/npm-5.der;"],
		["stream", "letsencrypt", "ssl_stapling_file /data/tls/certbot/live/npm-5.der;"],
		["stream", "other", "ssl_stapling_file /data/tls/custom/npm-5.der;"],
	];
	for (const [name, provider, line] of cases) {
		const host = (exists) => ({
			id: 3,
			enabled: true,
			certificate_id: 5,
			certificate: { provider },
			domain_names: ["a.example"],
			server_names: ["a.example"],
			forward_scheme: "http",
			forward_host: "backend",
			forward_port: 80,
			incoming_port: 99,
			tcp_forwarding: true,
			forwarding_host: "backend",
			forwarding_port: 1,
			npmpro_stapling_file_exists: exists,
			env,
		});
		const withFile = await render(name, host(true));
		assert.ok(withFile.includes(line), `${name} ${provider}`);
		assert.ok(withFile.includes("ssl_certificate_compression off;"), `${name} ${provider}`);
		const without = await render(name, host(false));
		assert.equal(without.includes("ssl_stapling"), false, `${name} ${provider}`);
		assert.ok(without.includes("ssl_certificate "), `${name} ${provider}`);
	}
});

it("regenerates all hosts when the runtime vars the env sets change, and the template version is 22", async () => {
	const envsSh = await readFile(path.join(ROOT, "rootfs/usr/local/bin/envs.sh"), "utf8");
	const hashLine = envsSh.split("\n").find((line) => line.startsWith("ENV_SHA512SUM="));
	assert.ok(hashLine.includes('echo "$NPMPRO_USER_ENV"'));
	assert.ok(envsSh.split("\n").includes('TV="22"'));
	assert.ok(envsSh.indexOf("export NPMPRO_USER_ENV") < envsSh.indexOf("ENV_SHA512SUM="));
});
