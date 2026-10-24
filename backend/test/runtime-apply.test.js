import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import nodeFs, { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { createRuntimeUpdater } from "../internal/runtime-update.js";
import { renderCertbotIni } from "../lib/certbot-ini.js";
import { renderDefaultCertConf } from "../lib/default-cert.js";
import { ownUpstream, proxyHostsForProvider } from "../lib/forward-auth.js";
import { DEFAULT_AVATAR, fetchGravatar } from "../lib/gravatar.js";
import { createIpRanges, parseCloudflareRanges } from "../lib/ip-ranges.js";
import { logIncludes, renderRotations } from "../lib/log-files.js";
import { createRuntimeApplier, PATHS, testAndReload, withFiles } from "../lib/runtime-apply.js";
import { beautifierOn, createRuntimeConfig, gravatarOn } from "../lib/runtime-config.js";
import { createHostRenderer, describeHosts } from "../lib/runtime-hosts.js";
import { mergeRuntimeConfig, rulesOf, UPSTREAM } from "../lib/runtime-rules.js";
import { accessLogDirective, createAccessLogSwitch } from "../lib/traffic/access-log.js";
import utils from "../lib/utils.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
const BOOT_ENV = { ACME_SERVER: LE };
const CRONTAB =
	"0 */1 * * * cron-ech.sh\n0 * * * * logrotate --state /data/nginx/logs/logrotate.state /run/npmpro/logrotate\n";

const LOGROTATE = "/data/nginx/logs/*.log {\n        daily\n        rotate 3\n        missingok\n}\n";

const hasLine = (text, line) => text.split("\n").includes(line);
const BOOM = /boom/u;
const EACCES = /EACCES/u;

const quietLog = () => {
	const lines = [];
	const add = (line) => lines.push(line);
	return { lines, warn: add, error: add, info: add, debug: (line) => add(`debug: ${line}`) };
};

const setup = async ({ crontab = CRONTAB, renewal = {} } = {}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "runtime-apply-"));
	const paths = {
		certbotIni: path.join(dir, "certbot.ini"),
		renewalDir: path.join(dir, "renewal"),
		crontabDir: path.join(dir, "crontabs"),
		defaultCertConf: path.join(dir, "default-cert.conf"),
		tlsDir: path.join(dir, "tls"),
		errorLogConf: path.join(dir, "error-log.conf"),
		streamLogConf: path.join(dir, "stream-log.conf"),
		accessLogConf: path.join(dir, "access-log.conf"),
		logrotateConf: path.join(dir, "logrotate"),
	};
	await writeFile(paths.certbotIni, "old ini\n");
	// what start.sh writes without LOGROTATE and TRAFFIC_STATS
	await writeFile(paths.errorLogConf, logIncludes(false).error);
	await writeFile(paths.streamLogConf, logIncludes(false).stream);
	await writeFile(paths.accessLogConf, accessLogDirective(false));
	await writeFile(paths.logrotateConf, LOGROTATE);
	// what start.sh writes without DEFAULT_CERT_ID
	await writeFile(paths.defaultCertConf, renderDefaultCertConf(null, paths.tlsDir));
	await mkdir(paths.renewalDir);
	for (const [name, content] of Object.entries(renewal)) await writeFile(path.join(paths.renewalDir, name), content);
	await mkdir(paths.crontabDir);
	if (crontab !== null) await writeFile(path.join(paths.crontabDir, "npmpro"), crontab);
	return { dir, paths };
};

const nginxFake = ({ testError } = {}) => {
	const calls = [];
	return {
		calls,
		test: () => {
			calls.push("test");
			return testError ? Promise.reject(new Error(testError)) : Promise.resolve();
		},
		reload: () => {
			calls.push("reload");
			return Promise.resolve();
		},
	};
};

const certValues = (overrides = {}) => ({ ...mergeRuntimeConfig("certificates", {}, BOOT_ENV).values, ...overrides });

const applier = (paths, overrides = {}) => {
	const restarts = [];
	const nginx = overrides.nginx ?? nginxFake();
	const log = quietLog();
	const fetched = [];
	const verifies = [];
	const instance = createRuntimeApplier({
		nginx,
		paths,
		log,
		timers: { restartRenewal: (hours) => restarts.push(hours) },
		env: () => BOOT_ENV,
		effectiveEnv: (o) => ({ overrides: o }),
		fetchDirectory: (server, options) => {
			fetched.push(server);
			verifies.push(options?.verify);
			return Promise.resolve({ directory: true, profiles: { classic: {}, shortlived: {} } });
		},
		...overrides,
	});
	return { ...instance, restarts, nginx, log, fetched, verifies };
};

// withFiles

it("withFiles writes atomically, keeps the mode and leaves no temp file", async () => {
	const { dir } = await setup();
	const file = path.join(dir, "a.conf");
	await writeFile(file, "old\n", { mode: 0o640 });
	const result = await withFiles([{ path: file, content: "new\n" }], async (written) => written);
	assert.deepEqual(result, [file]);
	assert.equal(await readFile(file, "utf8"), "new\n");
	assert.equal((await stat(file)).mode % 0o1000, 0o640);
	assert.deepEqual(
		(await readdir(dir)).filter((name) => name.includes("npmpro-tmp")),
		[],
	);
});

it("withFiles restores the previous contents when fn fails, and removes new files", async () => {
	const { dir } = await setup();
	const a = path.join(dir, "a.conf");
	const b = path.join(dir, "b.conf");
	await writeFile(a, "old a\n");
	await assert.rejects(
		withFiles(
			[
				{ path: a, content: "new a\n" },
				{ path: b, content: "new b\n" },
			],
			async () => {
				assert.equal(await readFile(a, "utf8"), "new a\n");
				throw new Error("boom");
			},
			{ log: quietLog() },
		),
		BOOM,
	);
	assert.equal(await readFile(a, "utf8"), "old a\n");
	await assert.rejects(readFile(b, "utf8"), { code: "ENOENT" });
});

it("withFiles restores written files when a later write fails and throws a non-public error", async () => {
	const { dir } = await setup();
	const a = path.join(dir, "a.conf");
	const b = path.join(dir, "b.conf");
	await writeFile(a, "old a\n");
	await writeFile(b, "old b\n");
	const failing = {
		...nodeFs,
		rename: (from, to) => (to === b ? Promise.reject(new Error("EACCES")) : nodeFs.rename(from, to)),
	};
	const log = quietLog();
	let ran = false;
	const err = await withFiles(
		[
			{ path: a, content: "new a\n" },
			{ path: b, content: "new b\n" },
		],
		() => {
			ran = true;
		},
		{ fs: failing, log },
	).catch((e) => e);
	assert.equal(err.message, `Could not write ${b}`);
	assert.equal(err.public, undefined);
	assert.equal(ran, false);
	assert.equal(await readFile(a, "utf8"), "old a\n");
	assert.equal(await readFile(b, "utf8"), "old b\n");
	assert.match(log.lines.join("\n"), EACCES);
});

it("testAndReload turns an nginx failure into a ValidationError with the message", async () => {
	const nginx = nginxFake({ testError: "nginx: [emerg] bad" });
	const err = await testAndReload(nginx).catch((e) => e);
	assert.equal(err.name, "ValidationError");
	assert.equal(err.public, true);
	assert.equal(err.message, "nginx: [emerg] bad");
	assert.deepEqual(nginx.calls, ["test"]);
});

// certificates

it("writes certbot.ini for a key change without reloading nginx", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = certValues();
	const next = { ...prev, key_type: "rsa", key_size: "3072" };
	const result = await a.applyGroup("certificates", next, prev);
	assert.deepEqual(result, { changed: ["key_type", "key_size"], reloaded: false });
	assert.equal(await readFile(paths.certbotIni, "utf8"), renderCertbotIni(next));
	assert.deepEqual(a.nginx.calls, []);
	assert.deepEqual(a.restarts, []);
});

it("restarts the renewal timer with the new interval", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = certValues();
	await a.applyGroup("certificates", { ...prev, renewal_interval: 12 }, prev);
	assert.deepEqual(a.restarts, [12]);
	assert.equal(await readFile(paths.certbotIni, "utf8"), "old ini\n");
});

it("rewrites the ECH crontab line and keeps the other lines", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = certValues();
	await a.applyGroup("certificates", { ...prev, ech_rotation_interval: 6 }, prev);
	assert.equal(
		await readFile(path.join(paths.crontabDir, "npmpro"), "utf8"),
		"0 */6 * * * cron-ech.sh\n0 * * * * logrotate --state /data/nginx/logs/logrotate.state /run/npmpro/logrotate\n",
	);
});

it("skips the crontab when there is none and logs it once", async () => {
	const { paths } = await setup({ crontab: null });
	const a = applier(paths);
	const prev = certValues();
	await a.applyGroup("certificates", { ...prev, ech_rotation_interval: 6 }, prev);
	await a.applyGroup("certificates", { ...prev, ech_rotation_interval: 7 }, prev);
	assert.deepEqual(await readdir(paths.crontabDir), []);
	assert.equal(a.log.lines.filter((line) => line.includes("No crontab")).length, 1);
});

it("checks a new profile against the ACME server and cleans the renewal confs", async () => {
	const conf = "[renewalparams]\nrequired_profile = shortlived\n";
	const { paths } = await setup({ renewal: { "a.conf": conf } });
	const a = applier(paths);
	const prev = certValues();
	await a.applyGroup("certificates", { ...prev, profile: "classic" }, prev);
	assert.deepEqual(a.fetched, [LE]);
	assert.ok(hasLine(await readFile(paths.certbotIni, "utf8"), "required-profile = classic"));
	assert.equal(await readFile(path.join(paths.renewalDir, "a.conf"), "utf8"), "[renewalparams]\n");
});

it("refuses a profile the ACME server does not offer and writes nothing", async () => {
	const conf = "required_profile = shortlived\n";
	const { paths } = await setup({ renewal: { "a.conf": conf } });
	const a = applier(paths);
	const prev = certValues();
	const err = await a
		.applyGroup("certificates", { ...prev, profile: "tlsserver", key_type: "rsa", key_size: "2048" }, prev)
		.catch((e) => e);
	assert.equal(err.name, "ValidationError");
	assert.equal(err.message, "The ACME server does not offer this profile");
	assert.equal(await readFile(paths.certbotIni, "utf8"), "old ini\n");
	assert.equal(await readFile(path.join(paths.renewalDir, "a.conf"), "utf8"), conf);
});

it("reports an unreachable ACME server", async () => {
	const { paths } = await setup();
	const prev = certValues();
	const down = applier(paths, {
		fetchDirectory: () => Promise.reject(new Error("timeout")),
	});
	const err = await down.applyGroup("certificates", { ...prev, profile: "classic" }, prev).catch((e) => e);
	assert.equal(err.message, "Could not check the ACME server profiles");
	assert.equal(err.public, true);
	const notAcme = applier(paths, { fetchDirectory: async () => ({ directory: false, profiles: {} }) });
	const err2 = await notAcme.applyGroup("certificates", { ...prev, profile: "classic" }, prev).catch((e) => e);
	assert.equal(err2.message, "Could not check the ACME server profiles");
});

it("does not check an empty profile and removes stale renewal profile lines", async () => {
	const { paths } = await setup({ renewal: { "a.conf": "x = 1\nrequired_profile = shortlived\n" } });
	const a = applier(paths);
	const prev = certValues();
	await a.applyGroup("certificates", { ...prev, profile: "" }, prev);
	assert.deepEqual(a.fetched, []);
	assert.equal(await readFile(path.join(paths.renewalDir, "a.conf"), "utf8"), "x = 1\n");
	assert.ok(hasLine(await readFile(paths.certbotIni, "utf8"), "#required-profile"));
});

it("does nothing when no value changed", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = certValues();
	assert.deepEqual(await a.applyGroup("certificates", { ...prev }, prev), { changed: [], reloaded: false });
	assert.equal(await readFile(paths.certbotIni, "utf8"), "old ini\n");
});

// reload path

it("renders hosts with the new values, tests and reloads nginx for a reload key", async () => {
	const { dir, paths } = await setup();
	const host = path.join(dir, "1.conf");
	await writeFile(host, "old host\n");
	const rendered = [];
	const a = applier(paths, {
		renderHosts: (group, ctx) => {
			rendered.push({ group, changed: ctx.changed, env: ctx.env, startup: ctx.startup });
			return Promise.resolve([{ path: host, content: "new host\n", nginx: true }]);
		},
	});
	const prev = certValues();
	const next = { ...prev, ocsp_stapling: !prev.ocsp_stapling };
	assert.deepEqual(await a.applyGroup("certificates", next, prev), { changed: ["ocsp_stapling"], reloaded: true });
	assert.deepEqual(rendered, [
		{
			group: "certificates",
			changed: ["ocsp_stapling"],
			env: { overrides: { certificates: next } },
			startup: false,
		},
	]);
	assert.deepEqual(a.nginx.calls, ["test", "reload"]);
	assert.equal(await readFile(host, "utf8"), "new host\n");
});

it("restores every file of the group and refuses the change when nginx -t fails", async () => {
	const { dir, paths } = await setup();
	const host = path.join(dir, "1.conf");
	await writeFile(host, "old host\n");
	const nginx = nginxFake({ testError: "nginx: [emerg] unknown directive" });
	const a = applier(paths, {
		nginx,
		renderHosts: async () => [{ path: host, content: "broken\n", nginx: true }],
	});
	const prev = certValues();
	const next = {
		...prev,
		ocsp_stapling: !prev.ocsp_stapling,
		ech_rotation_interval: 9,
		renewal_interval: 5,
		key_size: "secp256r1",
	};
	const err = await a.applyGroup("certificates", next, prev).catch((e) => e);
	assert.equal(err.name, "ValidationError");
	assert.equal(err.message, "nginx: [emerg] unknown directive");
	assert.deepEqual(nginx.calls, ["test"]);
	assert.equal(await readFile(host, "utf8"), "old host\n");
	assert.equal(await readFile(paths.certbotIni, "utf8"), "old ini\n");
	assert.equal(await readFile(path.join(paths.crontabDir, "npmpro"), "utf8"), CRONTAB);
	assert.deepEqual(a.restarts, []);
});

// startup

it("startup applyAll uses env values for env-set keys over stored ones and does not reload", async () => {
	const { paths } = await setup();
	const env = {
		...BOOT_ENV,
		ACME_KEY_TYPE: "rsa",
		ACME_KEY_SIZE: "2048",
		CERTBOT_RUN_INTERVAL: "7",
		ECH_ROTATION_INTERVAL: "4",
		NPMPRO_USER_ENV: "ACME_KEY_TYPE ACME_KEY_SIZE CERTBOT_RUN_INTERVAL ECH_ROTATION_INTERVAL",
	};
	const stored = {
		certificates: {
			key_type: "ecdsa",
			key_size: "secp521r1",
			renewal_interval: 20,
			ech_rotation_interval: 2,
			profile: "",
		},
	};
	const config = createRuntimeConfig({ env, readStored: async (group) => stored[group] ?? {}, log: quietLog() });
	const a = applier(paths, { getConfig: config.getRuntimeConfig });
	assert.deepEqual(await a.applyAll(), {});
	const ini = await readFile(paths.certbotIni, "utf8");
	assert.ok(hasLine(ini, "key-type = rsa"));
	assert.ok(hasLine(ini, "rsa-key-size = 2048"));
	assert.ok(hasLine(ini, "#required-profile"));
	assert.deepEqual(a.restarts, [7]);
	assert.ok(hasLine(await readFile(path.join(paths.crontabDir, "npmpro"), "utf8"), "0 */4 * * * cron-ech.sh"));
	assert.deepEqual(a.nginx.calls, []);
	assert.deepEqual(a.fetched, []);
});

it("startup applyAll applies stored values for keys the env did not set", async () => {
	const { paths } = await setup();
	const env = { ...BOOT_ENV, ACME_KEY_TYPE: "ecdsa", ACME_KEY_SIZE: "secp384r1", NPMPRO_USER_ENV: "" };
	const stored = {
		certificates: { key_size: "secp256r1", profile: "classic", profile_server: LE, renewal_interval: 20 },
	};
	const config = createRuntimeConfig({ env, readStored: async (group) => stored[group] ?? {}, log: quietLog() });
	const a = applier(paths, { getConfig: config.getRuntimeConfig });
	await a.applyAll();
	const ini = await readFile(paths.certbotIni, "utf8");
	assert.ok(hasLine(ini, "elliptic-curve = secp256r1"));
	assert.ok(hasLine(ini, "required-profile = classic"));
	assert.deepEqual(a.restarts, [20]);
});

it("startup tests nginx only when an nginx file changed, and a failing group does not stop the others", async () => {
	const { dir, paths } = await setup();
	const host = path.join(dir, "1.conf");
	const nginx = nginxFake({ testError: "nginx: [emerg] x" });
	const groups = [];
	const a = applier(paths, {
		nginx,
		getConfig: (group) => {
			groups.push(group);
			if (group === "network") return Promise.reject(new Error("db down"));
			return Promise.resolve({ values: group === "certificates" ? certValues() : {}, locked: [] });
		},
		renderHosts: async (group) => (group === "certificates" ? [{ path: host, content: "h\n", nginx: true }] : []),
	});
	const failed = await a.applyAll();
	assert.deepEqual(
		Object.keys(failed).toSorted((x, y) => x.localeCompare(y)),
		["certificates", "network"],
	);
	assert.equal(groups.length, 5);
	assert.deepEqual(nginx.calls, ["test"]);
	await assert.rejects(readFile(host, "utf8"), { code: "ENOENT" });
	assert.equal(a.log.lines.filter((line) => line.includes("at startup")).length, 2);
});

it("checks the profile with the server TLS verification of the new values", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = certValues();
	await a.applyGroup("certificates", { ...prev, profile: "classic", server_tls_verify: false }, prev);
	await a.applyGroup("certificates", { ...prev, profile: "classic" }, { ...prev, profile: "shortlived" });
	assert.deepEqual(a.verifies, [false, true]);
});

it("startup apply with the default paths writes the live certbot config and nothing under /etc", async () => {
	const touched = [];
	const record =
		(name) =>
		(file, ...rest) => {
			touched.push(String(file));
			if (name === "rename") touched.push(String(rest[0]));
			return Promise.resolve();
		};
	const missing = () => Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
	const fakeFs = {
		readFile: missing,
		readdir: missing,
		stat: missing,
		writeFile: record("writeFile"),
		rename: record("rename"),
		chmod: record("chmod"),
		rm: record("rm"),
	};
	const env = {
		...BOOT_ENV,
		ACME_KEY_TYPE: "rsa",
		ACME_KEY_SIZE: "2048",
		NPMPRO_USER_ENV: "ACME_KEY_TYPE ACME_KEY_SIZE",
	};
	const config = createRuntimeConfig({ env, readStored: () => Promise.resolve({}), log: quietLog() });
	const a = createRuntimeApplier({
		fs: fakeFs,
		nginx: nginxFake(),
		log: quietLog(),
		getConfig: config.getRuntimeConfig,
		timers: { restartRenewal: () => {} },
	});
	assert.deepEqual(await a.applyAll(), {});
	assert.ok(touched.includes(PATHS.certbotIni));
	assert.equal(PATHS.certbotIni, "/run/npmpro/certbot.ini");
	assert.deepEqual(
		touched.filter((file) => file.startsWith("/etc")),
		[],
	);
});

// default certificate and stapling

const certTree = async (paths) => {
	const live = path.join(paths.tlsDir, "certbot/live/npm-5");
	await mkdir(live, { recursive: true });
	await writeFile(path.join(live, "fullchain.pem"), "chain");
	await writeFile(path.join(live, "privkey.pem"), "key");
	await writeFile(path.join(paths.tlsDir, "certbot/live/npm-5.der"), "der");
	return live;
};

const certApplier = (paths, overrides = {}) => {
	const fetches = [];
	const a = applier(paths, {
		listCertificates: async () => [{ id: 5 }],
		ocsp: { fetch: async (kind, options) => fetches.push(options?.force ? kind : `${kind} unforced`) },
		...overrides,
	});
	return { ...a, fetches };
};

it("setting the default certificate writes its paths to the include and reloads", async () => {
	const { paths } = await setup();
	const live = await certTree(paths);
	const a = certApplier(paths);
	const prev = certValues();
	const result = await a.applyGroup("certificates", { ...prev, default_certificate_id: 5 }, prev);
	assert.deepEqual(result, { changed: ["default_certificate_id"], reloaded: true });
	assert.equal(
		await readFile(paths.defaultCertConf, "utf8"),
		`ssl_certificate ${live}/fullchain.pem;\nssl_certificate_key ${live}/privkey.pem;\n`,
	);
	assert.deepEqual(a.nginx.calls, ["test", "reload"]);
	assert.deepEqual(a.fetches, []);
});

it("a default certificate that was deleted renders the built-in certificate and logs once", async () => {
	const { paths } = await setup();
	await certTree(paths);
	const a = certApplier(paths, { listCertificates: async () => [] });
	const stored = certValues({ default_certificate_id: 5, ocsp_stapling: false });
	// stapling saves while the stored default certificate is gone: built-in, logged once
	await a.applyGroup("certificates", { ...stored, ocsp_stapling: true }, stored);
	await a.applyGroup("certificates", stored, { ...stored, ocsp_stapling: true });
	assert.equal(await readFile(paths.defaultCertConf, "utf8"), renderDefaultCertConf(null, paths.tlsDir));
	assert.equal(a.log.lines.filter((line) => line.includes("#5 does not exist")).length, 1);
	// startup with the stored id: same fallback, the start.sh include is kept, nginx is not tested
	const b = certApplier(paths, { listCertificates: async () => [] });
	await b.applyGroup("certificates", stored);
	assert.deepEqual(b.nginx.calls, []);
	assert.equal(b.log.lines.filter((line) => line.includes("#5 does not exist")).length, 1);
});

it("saving a default certificate whose files are missing, or that is gone, is refused and writes nothing", async () => {
	const { paths } = await setup();
	const before = await readFile(paths.defaultCertConf, "utf8");
	const prev = certValues();
	const missingFiles = certApplier(paths);
	await assert.rejects(missingFiles.applyGroup("certificates", { ...prev, default_certificate_id: 5 }, prev), {
		name: "ValidationError",
		message: "default_certificate_id: the certificate files are missing",
	});
	const gone = certApplier(paths, { listCertificates: async () => [] });
	await assert.rejects(gone.applyGroup("certificates", { ...prev, default_certificate_id: 5 }, prev), {
		name: "ValidationError",
		message: "default_certificate_id: Certificate not found",
	});
	assert.equal(await readFile(paths.defaultCertConf, "utf8"), before);
	assert.deepEqual([...missingFiles.nginx.calls, ...gone.nginx.calls], []);
	// at startup the same id falls back quietly
	const startup = certApplier(paths);
	await startup.applyGroup("certificates", { ...prev, default_certificate_id: 5 });
	assert.equal(startup.log.lines.filter((line) => line.includes("#5 are missing")).length, 1);
});

it("a startup nginx -t failure restores only the include, the other certificate settings still apply", async () => {
	const { paths } = await setup();
	await certTree(paths);
	const before = await readFile(paths.defaultCertConf, "utf8");
	const a = certApplier(paths, { nginx: nginxFake({ testError: "nginx: [emerg] x" }) });
	const values = certValues({ default_certificate_id: 5, key_size: "secp256r1", renewal_interval: 9 });
	await assert.rejects(a.applyGroup("certificates", values), { message: "nginx: [emerg] x" });
	assert.equal(await readFile(paths.certbotIni, "utf8"), renderCertbotIni(values));
	assert.deepEqual(a.restarts, [9]);
	assert.equal(await readFile(paths.defaultCertConf, "utf8"), before);
	assert.deepEqual(a.nginx.calls, ["test"]);
});

it("turning stapling on fetches the OCSP responses, staples the default certificate and re-renders hosts", async () => {
	const { dir, paths } = await setup();
	const live = await certTree(paths);
	const host = path.join(dir, "1.conf");
	await writeFile(host, "no stapling\n");
	const rendered = [];
	const a = certApplier(paths, {
		renderHosts: (_group, ctx) => {
			rendered.push(ctx.changed);
			return Promise.resolve([
				{ path: host, content: `stapling ${ctx.env.overrides.certificates.ocsp_stapling}\n`, nginx: true },
			]);
		},
	});
	const prev = certValues({ default_certificate_id: 5, ocsp_stapling: false });
	const on = { ...prev, ocsp_stapling: true };
	await a.applyGroup("certificates", on, prev);
	assert.deepEqual(a.fetches, ["acme"]);
	assert.deepEqual(rendered, [["ocsp_stapling"]]);
	assert.equal(await readFile(host, "utf8"), "stapling true\n");
	assert.ok(hasLine(await readFile(paths.defaultCertConf, "utf8"), `ssl_stapling_file ${live}.der;`));

	await a.applyGroup("certificates", prev, on);
	assert.deepEqual(a.fetches, ["acme"]);
	assert.equal(await readFile(host, "utf8"), "stapling false\n");
	assert.equal((await readFile(paths.defaultCertConf, "utf8")).includes("ssl_stapling"), false);
	assert.deepEqual(a.nginx.calls, ["test", "reload", "test", "reload"]);
});

it("custom stapling fetches the custom OCSP responses only", async () => {
	const { paths } = await setup();
	const a = certApplier(paths);
	const prev = certValues({ custom_ocsp_stapling: false });
	await a.applyGroup("certificates", { ...prev, custom_ocsp_stapling: true }, prev);
	assert.deepEqual(a.fetches, ["custom"]);
});

it("startup fetches OCSP responses only when launch.sh did not (stapling on from the stored value)", async () => {
	const { paths } = await setup();
	const fromStored = certApplier(paths, { env: () => ({ ...BOOT_ENV, ACME_OCSP_STAPLING: "false" }) });
	await fromStored.applyGroup("certificates", certValues({ ocsp_stapling: true }));
	assert.deepEqual(fromStored.fetches, ["acme"]);
	const fromEnv = certApplier(paths, { env: () => ({ ...BOOT_ENV, ACME_OCSP_STAPLING: "true" }) });
	await fromEnv.applyGroup("certificates", certValues({ ocsp_stapling: true }));
	assert.deepEqual(fromEnv.fetches, []);
});

it("an nginx -t failure restores the include and the hosts and stores nothing", async () => {
	const { dir, paths } = await setup();
	await certTree(paths);
	const host = path.join(dir, "1.conf");
	await writeFile(host, "old host\n");
	const before = await readFile(paths.defaultCertConf, "utf8");
	const a = certApplier(paths, {
		nginx: nginxFake({ testError: "nginx: [emerg] cannot load certificate" }),
		renderHosts: async () => [{ path: host, content: "new host\n", nginx: true }],
	});
	const saved = [];
	const update = createRuntimeUpdater({
		readStored: async () => ({}),
		saveStored: async (_group, meta) => saved.push(meta),
		getApply: () => a.applyGroup,
		findCertificate: async (id) => (id === 5 ? { id, provider: "letsencrypt" } : undefined),
		env: BOOT_ENV,
	});
	await assert.rejects(update("certificates", { default_certificate_id: 5, ocsp_stapling: true }), {
		name: "ValidationError",
		message: "nginx: [emerg] cannot load certificate",
	});
	assert.deepEqual(saved, []);
	assert.equal(await readFile(paths.defaultCertConf, "utf8"), before);
	assert.equal(await readFile(host, "utf8"), "old host\n");
	await assert.rejects(update("certificates", { default_certificate_id: 9 }), {
		name: "ValidationError",
		message: "default_certificate_id: Certificate not found",
	});
	assert.deepEqual(saved, []);
});

it("startup with env DEFAULT_CERT_ID keeps the include start.sh wrote and does not test nginx", async () => {
	const { paths } = await setup();
	const live = await certTree(paths);
	const startSh = `ssl_certificate ${live}/fullchain.pem;\nssl_certificate_key ${live}/privkey.pem;\n`;
	await writeFile(paths.defaultCertConf, startSh);
	const env = { ...BOOT_ENV, DEFAULT_CERT_ID: "5", NPMPRO_USER_ENV: "DEFAULT_CERT_ID" };
	// a stored id is ignored while the env sets one
	const config = createRuntimeConfig({
		env,
		readStored: async () => ({ default_certificate_id: 6 }),
		log: quietLog(),
	});
	const a = certApplier(paths, { getConfig: config.getRuntimeConfig, env: () => env });
	assert.deepEqual(await a.applyAll(), {});
	assert.equal(await readFile(paths.defaultCertConf, "utf8"), startSh);
	assert.deepEqual(a.nginx.calls, []);
});

it("startup with a stored default certificate rewrites the include and tests nginx, a failure keeps start.sh's file", async () => {
	const { paths } = await setup();
	await certTree(paths);
	const before = await readFile(paths.defaultCertConf, "utf8");
	const config = createRuntimeConfig({
		env: { ...BOOT_ENV, NPMPRO_USER_ENV: "" },
		readStored: async (group) => (group === "certificates" ? { default_certificate_id: 5 } : {}),
		log: quietLog(),
	});
	const ok = certApplier(paths, { getConfig: config.getRuntimeConfig });
	assert.deepEqual(await ok.applyAll(), {});
	assert.ok((await readFile(paths.defaultCertConf, "utf8")).includes("npm-5/fullchain.pem"));
	assert.deepEqual(ok.nginx.calls, ["test"]);

	await writeFile(paths.defaultCertConf, before);
	const failing = certApplier(paths, {
		getConfig: config.getRuntimeConfig,
		nginx: nginxFake({ testError: "nginx: [emerg] x" }),
	});
	assert.deepEqual(Object.keys(await failing.applyAll()), ["certificates"]);
	assert.equal(await readFile(paths.defaultCertConf, "utf8"), before);
});

// network: trusted IPs and Cloudflare

const CF_V4 = "173.245.48.0/20\n103.21.244.0/22\nnot a range\n";
const CF_V6 = "2400:cb00::/32\n";
const CF_LINES = ["  set_real_ip_from 173.245.48.0/20;", "  set_real_ip_from 103.21.244.0/22;"];
const quietConfig = (stored = {}, env = {}) =>
	createRuntimeConfig({ env, readStored: async (group) => stored[group] ?? {}, log: quietLog() });
const netValues = (overrides = {}) => ({ ...mergeRuntimeConfig("network", {}, {}).values, ...overrides });

const fakeClock = () => {
	const timers = new Map();
	let next = 1;
	return {
		timers,
		setInterval: (fn, ms) => {
			timers.set(next, { fn, ms });
			return next++;
		},
		clearInterval: (id) => timers.delete(id),
	};
};

const networkSetup = async ({ fetchError, nginx, cfNginxFake, stored = {} } = {}) => {
	const { dir, paths } = await setup();
	paths.ipRangesConf = path.join(dir, "ip_ranges.conf");
	await writeFile(paths.ipRangesConf, "old ranges\n");
	const config = quietConfig(stored);
	await config.loadRuntimeConfig();
	const clock = fakeClock();
	const fetches = [];
	const cfNginx = cfNginxFake ?? nginxFake();
	const cfLog = quietLog();
	const ipRanges = createIpRanges({
		nginx: cfNginx,
		fetchText: (url) => {
			fetches.push(url);
			if (fetchError) return Promise.reject(new Error(fetchError));
			return Promise.resolve(url.endsWith("v4") ? CF_V4 : CF_V6);
		},
		effectiveEnv: config.effectiveEnv,
		log: cfLog,
		path: paths.ipRangesConf,
		clock,
	});
	const a = applier(paths, { ipRanges, effectiveEnv: config.effectiveEnv, ...(nginx ? { nginx } : {}) });
	return { ...a, paths, config, clock, fetches, ipRanges, cfNginx, cfLog };
};

const lines = async (file) => (await readFile(file, "utf8")).split("\n").filter(Boolean);

it("renders the trusted IPs (IPv4, IPv6, CIDR) into ip_ranges.conf, then tests and reloads", async () => {
	const n = await networkSetup();
	const trusted = ["10.0.0.1", "fd00::1", "192.168.0.0/16", "2001:db8::/32"];
	const result = await n.applyGroup("network", netValues({ trusted_ips: trusted }), netValues());
	assert.deepEqual(result, { changed: ["trusted_ips"], reloaded: true });
	assert.deepEqual(
		await lines(n.paths.ipRangesConf),
		trusted.map((ip) => `  set_real_ip_from ${ip};`),
	);
	assert.deepEqual(n.nginx.calls, ["test", "reload"]);
	assert.deepEqual(n.fetches, []);
	assert.equal(n.ipRanges.running(), false);
});

it("Cloudflare on fetches the ranges and starts the timer, off stops it and removes the ranges", async () => {
	const n = await networkSetup();
	const on = netValues({ trusted_ips: ["10.0.0.1"], trust_cloudflare: true });
	await n.applyGroup("network", on, netValues({ trusted_ips: ["10.0.0.1"] }));
	assert.equal(n.fetches.length, 2);
	assert.deepEqual(await lines(n.paths.ipRangesConf), [
		"  set_real_ip_from 10.0.0.1;",
		...CF_LINES,
		"  set_real_ip_from 2400:cb00::/32;",
	]);
	assert.equal(n.ipRanges.running(), true);
	assert.deepEqual(
		[...n.clock.timers.values()].map(({ ms }) => ms),
		[3_600_000],
	);

	// a trusted IP change keeps the fetched ranges without fetching again
	const more = { ...on, trusted_ips: ["10.0.0.1", "10.0.0.2"] };
	await n.applyGroup("network", more, on);
	assert.equal(n.fetches.length, 2);
	assert.ok((await lines(n.paths.ipRangesConf)).includes(CF_LINES[0]));

	await n.applyGroup("network", { ...more, trust_cloudflare: false }, more);
	assert.deepEqual(await lines(n.paths.ipRangesConf), [
		"  set_real_ip_from 10.0.0.1;",
		"  set_real_ip_from 10.0.0.2;",
	]);
	assert.equal(n.ipRanges.running(), false);
	assert.equal(n.clock.timers.size, 0);
	assert.deepEqual(n.nginx.calls, ["test", "reload", "test", "reload", "test", "reload"]);
});

it("Cloudflare on refuses the save when the ranges cannot be fetched, nothing written", async () => {
	const n = await networkSetup({ fetchError: "offline" });
	await assert.rejects(n.applyGroup("network", netValues({ trust_cloudflare: true }), netValues()), {
		name: "ValidationError",
		message: "trust_cloudflare: Could not fetch the Cloudflare IP ranges",
	});
	assert.equal(await readFile(n.paths.ipRangesConf, "utf8"), "old ranges\n");
	assert.deepEqual(n.nginx.calls, []);
	assert.equal(n.ipRanges.running(), false);
});

it("a failing nginx -t restores ip_ranges.conf and does not start the timer", async () => {
	const n = await networkSetup({ nginx: nginxFake({ testError: "nginx: [emerg] invalid parameter" }) });
	await assert.rejects(
		n.applyGroup("network", netValues({ trusted_ips: ["10.0.0.1"], trust_cloudflare: true }), netValues()),
		{ name: "ValidationError", message: "nginx: [emerg] invalid parameter" },
	);
	assert.equal(await readFile(n.paths.ipRangesConf, "utf8"), "old ranges\n");
	assert.equal(n.ipRanges.running(), false);
});

it("startup renders ip_ranges.conf with the stored values, fetches Cloudflare and starts the timer, no reload", async () => {
	const stored = { network: { trusted_ips: ["fd00::/8"], trust_cloudflare: true } };
	const n = await networkSetup({ stored });
	await n.applyGroup("network", (await n.config.getRuntimeConfig("network")).values);
	assert.deepEqual(await lines(n.paths.ipRangesConf), [
		"  set_real_ip_from fd00::/8;",
		...CF_LINES,
		"  set_real_ip_from 2400:cb00::/32;",
	]);
	assert.deepEqual(n.nginx.calls, ["test"]);
	assert.equal(n.ipRanges.running(), true);
});

it("startup with Cloudflare unreachable still writes the trusted IPs and starts the timer", async () => {
	const stored = { network: { trusted_ips: ["10.0.0.1"], trust_cloudflare: true } };
	const n = await networkSetup({ stored, fetchError: "offline" });
	await n.applyGroup("network", (await n.config.getRuntimeConfig("network")).values);
	assert.deepEqual(await lines(n.paths.ipRangesConf), ["  set_real_ip_from 10.0.0.1;"]);
	assert.equal(n.ipRanges.running(), true);
});

it("the refresh timer writes new Cloudflare ranges with the saved trusted IPs, and stops writing once off", async () => {
	const stored = { network: { trusted_ips: ["10.0.0.1"], trust_cloudflare: true } };
	const n = await networkSetup({ stored });
	await n.applyGroup("network", (await n.config.getRuntimeConfig("network")).values);
	await writeFile(n.paths.ipRangesConf, "stale\n");
	const [{ fn }] = [...n.clock.timers.values()];
	await fn();
	assert.deepEqual(await lines(n.paths.ipRangesConf), [
		"  set_real_ip_from 10.0.0.1;",
		...CF_LINES,
		"  set_real_ip_from 2400:cb00::/32;",
	]);
	assert.deepEqual(n.cfNginx.calls, ["test", "reload"]);

	// turned off (saved): a tick that was already running does not write
	n.config.prime("network", { values: { trusted_ips: ["10.0.0.1"], trust_cloudflare: false }, locked: [] });
	n.ipRanges.stop();
	await writeFile(n.paths.ipRangesConf, "after off\n");
	await n.ipRanges.refresh();
	assert.equal(await readFile(n.paths.ipRangesConf, "utf8"), "after off\n");
});

it("the refresh writes inside the runtime settings queue, an empty Cloudflare list writes nothing", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "ip-ranges-"));
	const file = path.join(dir, "ip_ranges.conf");
	const order = [];
	let body = { v4: CF_V4, v6: CF_V6 };
	const nginx = nginxFake();
	const ipRanges = createIpRanges({
		nginx,
		fetchText: (url) => Promise.resolve(url.endsWith("v4") ? body.v4 : body.v6),
		exclusive: async (fn) => {
			order.push("queue start");
			await fn();
			order.push("queue end");
		},
		effectiveEnv: () => ({ TRUST_CLOUDFLARE: "true", TRUST_IP: "10.0.0.1" }),
		log: quietLog(),
		path: file,
		clock: fakeClock(),
	});
	ipRanges.start();
	await ipRanges.refresh();
	assert.deepEqual(order, ["queue start", "queue end"]);
	assert.deepEqual(nginx.calls, ["test", "reload"]);
	assert.equal((await lines(file)).length, 4);

	body = { v4: "", v6: "" };
	await writeFile(file, "kept\n");
	await ipRanges.refresh();
	assert.equal(await readFile(file, "utf8"), "kept\n");
	assert.deepEqual(order, ["queue start", "queue end"]);
	assert.deepEqual(parseCloudflareRanges(CF_V4, CF_V6), ["173.245.48.0/20", "103.21.244.0/22", "2400:cb00::/32"]);
});

// forward authentication

const proxyHost = (id, auth = {}, locations = []) => ({ id, enabled: 1, ...auth, locations });

it("proxyHostsForProvider: hosts using the provider (host or enabled location) without an own upstream", () => {
	const hosts = [
		proxyHost(1, { npmpro_auth_request: "anubis" }),
		proxyHost(2, { npmpro_auth_request: "anubis", npmpro_auth_request_upstream: "http://own:8923" }),
		proxyHost(3, {}, [{ npmpro_auth_request: "anubis" }]),
		proxyHost(4, {}, [{ npmpro_auth_request: "anubis", npmpro_enabled: false }]),
		proxyHost(5, {}, [{ npmpro_auth_request: "anubis", npmpro_auth_request_upstream: "http://loc:1" }]),
		proxyHost(6, { npmpro_auth_request: "tinyauth" }),
		proxyHost(7, { npmpro_auth_request: "authentik-send-basic-auth" }),
		// the host's upstream is for tinyauth, its location uses anubis without one
		proxyHost(8, { npmpro_auth_request: "tinyauth", npmpro_auth_request_upstream: "http://t:1" }, [
			{ npmpro_auth_request: "anubis" },
		]),
	];
	assert.deepEqual(
		proxyHostsForProvider(hosts, "anubis").map((host) => host.id),
		[1, 3, 8],
	);
	assert.deepEqual(
		proxyHostsForProvider(hosts, "authentik").map((host) => host.id),
		[7],
	);
	assert.equal(ownUpstream(hosts[4], "anubis"), "http://loc:1");
});

const forwardAuthRenderer = (rows, files) => {
	const renders = [];
	const modelOf = (list) => ({
		query: () => ({ where: (c, v) => ({ withGraphFetched: async () => list.filter((row) => row[c] === v) }) }),
	});
	const instance = createHostRenderer({
		hostTypes: [
			[modelOf(rows), "proxy_host", "locations"],
			[modelOf([{ id: 1, enabled: 1, npmpro_auth_request: "anubis" }]), "redirection_host", "certificate"],
		],
		getConfigName: (type, id) => files[`${type}/${id}`] ?? `/missing/${type}/${id}.conf`,
		renderConfig: (type, host, options) => {
			renders.push({ type, id: host.id, env: options.env });
			return Promise.resolve(`rendered ${type} ${host.id} ${options.env.AUTH_REQUEST_ANUBIS_UPSTREAM}\n`);
		},
		exists: (file) => Object.values(files).includes(file),
	});
	return { ...instance, renders };
};

it("a forward-auth default re-renders only the proxy hosts that use it without an own upstream", async () => {
	const rows = [
		proxyHost(1, { npmpro_auth_request: "anubis" }),
		proxyHost(2, { npmpro_auth_request: "anubis", npmpro_auth_request_upstream: "http://own:8923" }),
		proxyHost(3, { npmpro_auth_request: "tinyauth" }),
		proxyHost(4, {}, [{ npmpro_auth_request: "anubis" }]),
	];
	const files = Object.fromEntries(rows.map((row) => [`proxy_host/${row.id}`, `/c/${row.id}.conf`]));
	files["redirection_host/1"] = "/c/r1.conf";
	const r = forwardAuthRenderer(rows, files);
	const env = { AUTH_REQUEST_ANUBIS_UPSTREAM: "http://anubis:8923" };
	const out = await r.renderRuntimeHosts("forward-auth", { changed: ["anubis_upstream"], startup: false, env });
	assert.deepEqual(
		out.map((file) => file.path),
		["/c/1.conf", "/c/4.conf"],
	);
	assert.equal(out[0].content, "rendered proxy_host 1 http://anubis:8923\n");
	// the custom images switch follows every host using Anubis
	const images = await r.renderRuntimeHosts("forward-auth", { changed: ["anubis_custom_images"], env });
	assert.deepEqual(
		images.map((file) => file.path),
		["/c/1.conf", "/c/2.conf", "/c/4.conf"],
	);
	assert.deepEqual(await r.renderRuntimeHosts("forward-auth", { changed: ["anubis_upstream"], startup: true }), []);
});

it("the proxy host template uses the host's own upstream over the forward-auth default", async () => {
	const template = await readFile(path.join(import.meta.dirname, "../templates/proxy_host.conf"), "utf8");
	const env = { AUTH_REQUEST_ANUBIS_UPSTREAM: "http://default-anubis:8923" };
	const render = (host) =>
		utils.getRenderEngine().parseAndRender(template, {
			id: 7,
			domain_names: ["a.example"],
			server_names: ["a.example"],
			forward_scheme: "http",
			forward_host: "backend",
			forward_port: 80,
			...host,
			auth_request_anubis_upstream_resolved: ownUpstream(host, "anubis"),
			env,
		});
	const own = await render({ npmpro_auth_request: "anubis", npmpro_auth_request_upstream: "http://own:8923" });
	assert.ok(own.includes("server own:8923 resolve;"));
	assert.equal(own.includes("default-anubis"), false);
	const byDefault = await render({ npmpro_auth_request: "anubis" });
	assert.ok(byDefault.includes("server default-anubis:8923 resolve;"));
});

it("a forward-auth save that fails nginx -t restores the host configs and stores nothing", async () => {
	const { dir, paths } = await setup();
	const conf = path.join(dir, "1.conf");
	await writeFile(conf, "old host\n");
	const rows = [proxyHost(1, { npmpro_auth_request: "anubis" })];
	const r = forwardAuthRenderer(rows, { "proxy_host/1": conf });
	const config = quietConfig();
	await config.loadRuntimeConfig();
	const a = applier(paths, {
		nginx: nginxFake({ testError: "nginx: [emerg] host not found in upstream" }),
		renderHosts: r.renderRuntimeHosts,
		effectiveEnv: config.effectiveEnv,
	});
	const saved = [];
	const update = createRuntimeUpdater({
		readStored: async () => ({}),
		saveStored: async (_group, meta) => saved.push(meta),
		getApply: () => a.applyGroup,
		env: {},
	});
	await assert.rejects(update("forward-auth", { anubis_upstream: "http://bad:1" }), {
		name: "ValidationError",
		message: "nginx: [emerg] host not found in upstream",
	});
	assert.deepEqual(saved, []);
	assert.equal(await readFile(conf, "utf8"), "old host\n");
	// rendered with the values being saved
	assert.equal(r.renders[0].env.AUTH_REQUEST_ANUBIS_UPSTREAM, "http://bad:1");
});

// advanced: beautifier and Gravatar

it("advanced settings apply without files or a reload", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = mergeRuntimeConfig("advanced", {}, {}).values;
	const result = await a.applyGroup("advanced", { ...prev, config_beautifier: false, gravatar: false }, prev);
	assert.deepEqual(result, { changed: ["config_beautifier", "gravatar"], reloaded: false });
	assert.deepEqual(a.nginx.calls, []);
});

it("beautifier off skips the beautifier on the next render, also with the values of a save", async () => {
	const boot = { DISABLE_NGINX_BEAUTIFIER: "false", NPMPRO_USER_ENV: "" };
	const config = quietConfig({}, boot);
	await config.loadRuntimeConfig();
	assert.equal(beautifierOn(config.effectiveEnv()), true);
	config.prime("advanced", { values: { config_beautifier: false, gravatar: true }, locked: [] });
	assert.equal(beautifierOn(config.effectiveEnv()), false);
	// a forward-auth save renders with effectiveEnv({ "forward-auth": next }): the saved beautifier value applies
	assert.equal(beautifierOn(config.effectiveEnv({ "forward-auth": { anubis_upstream: "" } })), false);
	assert.equal(beautifierOn(config.effectiveEnv({ advanced: { config_beautifier: true } })), true);

	const source = await readFile(path.join(import.meta.dirname, "../internal/nginx.js"), "utf8");
	assert.ok(source.includes("beautifierOn(host.env)"));
	assert.equal(source.includes("process.env.DISABLE_NGINX_BEAUTIFIER"), false);
});

it("Gravatar off gives the default avatar at the next profile update without contacting Gravatar", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "gravatar-"));
	const config = quietConfig({}, { DISABLE_GRAVATAR: "false", NPMPRO_USER_ENV: "" });
	await config.loadRuntimeConfig();
	const requests = [];
	const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
	const deps = {
		enabled: () => gravatarOn(config.effectiveEnv()),
		fetch: (url) => {
			requests.push(url);
			return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(png) });
		},
		fs: nodeFs,
		dir,
		log: quietLog(),
	};
	const on = await fetchGravatar(1, "a@example.com", "Ann Bee", deps);
	assert.ok(on.startsWith("/images/gravatar/1.png?v="));
	assert.deepEqual(await readdir(dir), ["1.png"]);

	config.prime("advanced", { values: { config_beautifier: true, gravatar: false }, locked: [] });
	assert.equal(await fetchGravatar(1, "a@example.com", "Ann Bee", deps), DEFAULT_AVATAR);
	assert.equal(requests.length, 1);
	// the fetched picture is removed
	assert.deepEqual(await readdir(dir), []);

	const source = await readFile(path.join(import.meta.dirname, "../internal/user.js"), "utf8");
	assert.equal(source.includes("process.env.DISABLE_GRAVATAR"), false);
});

// fix round 1

const FRONTEND_UPSTREAM = /const upstreamUrlPattern = \/(?<source>.+)\/u;/u;
const INJECTIONS = [
	"http://cu_a;} location ~ x {",
	"http://a\nb:1",
	"http://a:1\n",
	"http://a#b:1",
	"http://$host:1",
	"http://cu_$x",
	"http://a b:1",
	"http://a'b:1",
	'http://a"b:1',
	"http://a\\b:1",
	"http://cu_x}",
	"http://cu_x{",
	"http://a\tb:1",
];
const VALID_UPSTREAMS = ["http://a:1", "https://[::1]:8443", "http://cu_name", "https://auth.example:443"];

it("upstream values with whitespace or nginx syntax characters are refused everywhere", async () => {
	const validate = rulesOf("forward-auth").find((rule) => rule.key === "anubis_upstream").validate;
	const schema = JSON.parse(
		await readFile(path.join(import.meta.dirname, "../schema/components/proxy-host-object.json"), "utf8"),
	);
	const schemaPattern = new RegExp(schema.properties.npmpro_auth_request_upstream.pattern, "u");
	const frontend = await readFile(
		path.join(import.meta.dirname, "../../frontend/src/modules/Validations.jsx"),
		"utf8",
	);
	const frontendSource = frontend.match(FRONTEND_UPSTREAM).groups.source;
	// the frontend uses the same expression as the backend
	assert.equal(frontendSource, UPSTREAM.source);
	const envsSh = await readFile(path.join(import.meta.dirname, "../../rootfs/usr/local/bin/envs.sh"), "utf8");
	const block = envsSh.slice(
		envsSh.indexOf("AUTH_REQUEST_UPSTREAM_REGEX="),
		envsSh.indexOf("unset name value") + "unset name value".length,
	);
	const envsAccepts = (value) =>
		spawnSync("sh", ["-c", block.replace("sleep inf", "exit 3")], {
			env: { PATH: process.env.PATH, AUTH_REQUEST_ANUBIS_UPSTREAM: value },
		}).status === 0;

	for (const value of INJECTIONS) {
		assert.notEqual(validate(value), null, value);
		assert.equal(UPSTREAM.test(value), false, value);
		assert.equal(schemaPattern.test(value), false, value);
		assert.equal(envsAccepts(value), false, value);
	}
	for (const value of VALID_UPSTREAMS) {
		assert.equal(validate(value), null, value);
		assert.equal(schemaPattern.test(value), true, value);
		assert.equal(envsAccepts(value), true, value);
	}
	assert.equal(schemaPattern.test(""), true);
	// an env value that is refused is not used (not locked, the stored value or default applies)
	const merged = mergeRuntimeConfig("forward-auth", {}, { AUTH_REQUEST_ANUBIS_UPSTREAM: INJECTIONS[0] });
	assert.equal(merged.values.anubis_upstream, "");
});

it("clearing a forward-auth default refuses the save while proxy hosts still rely on it, before any render", async () => {
	const { paths } = await setup();
	const rows = [
		{ id: 1, enabled: 1, domain_names: ["a.example"], npmpro_auth_request: "anubis", locations: [] },
		{ id: 2, enabled: 0, domain_names: ["b.example"], npmpro_auth_request: "anubis", locations: [] },
		{
			id: 3,
			enabled: 1,
			domain_names: ["c.example"],
			npmpro_auth_request: "anubis",
			npmpro_auth_request_upstream: "http://own:1",
			locations: [],
		},
		{ id: 4, enabled: 1, domain_names: ["d.example"], npmpro_auth_request: "tinyauth", locations: [] },
	];
	const queried = [];
	const proxyModel = {
		query: () => ({
			withGraphFetched: (graph) => {
				queried.push(graph);
				return Promise.resolve(rows);
			},
		}),
	};
	const renders = [];
	const renderer = createHostRenderer({
		hostTypes: [
			[proxyModel, "proxy_host", "locations"],
			[proxyModel, "redirection_host", "certificate"],
		],
		getConfigName: () => "/x",
		renderConfig: () => {
			renders.push(1);
			return Promise.resolve("");
		},
	});
	const a = applier(paths, {
		proxyHostsUsingDefault: renderer.proxyHostsUsingDefault,
		renderHosts: () => {
			renders.push("hosts");
			return Promise.resolve([]);
		},
	});
	const prev = { ...mergeRuntimeConfig("forward-auth", {}, {}).values, anubis_upstream: "http://anubis:8923" };
	await assert.rejects(a.applyGroup("forward-auth", { ...prev, anubis_upstream: "" }, prev), {
		name: "ValidationError",
		message: "anubis_upstream: still used by proxy hosts without their own upstream: a.example, b.example",
	});
	assert.deepEqual(renders, []);
	assert.deepEqual(queried, ["locations"]);
	assert.deepEqual(a.nginx.calls, []);
	// changing it to another value, or clearing one nobody relies on, is fine
	await a.applyGroup("forward-auth", { ...prev, anubis_upstream: "http://other:1" }, prev);
	const tiny = { ...prev, tinyauth_upstream: "http://t:1" };
	await assert.rejects(a.applyGroup("forward-auth", { ...tiny, tinyauth_upstream: "" }, tiny), {
		message: "tinyauth_upstream: still used by proxy hosts without their own upstream: d.example",
	});
	const authelia = { ...prev, authelia_upstream: "http://au:1" };
	await a.applyGroup("forward-auth", { ...authelia, authelia_upstream: "" }, authelia);
	assert.equal(
		describeHosts([1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, domain_names: [`h${id}.example`] }))),
		"h1.example, h2.example, h3.example, h4.example, h5.example and 2 more",
	);
	assert.equal(describeHosts([{ id: 9, domain_names: [] }]), "#9");
});

it("startup: a failing nginx -t keeps the previous ip_ranges.conf, logs it and still starts the Cloudflare timer", async () => {
	const stored = { network: { trusted_ips: ["10.0.0.1"], trust_cloudflare: true } };
	const n = await networkSetup({ stored, nginx: nginxFake({ testError: "nginx: [emerg] unrelated host" }) });
	await assert.rejects(n.applyGroup("network", (await n.config.getRuntimeConfig("network")).values), {
		message: "nginx: [emerg] unrelated host",
	});
	assert.equal(await readFile(n.paths.ipRangesConf, "utf8"), "old ranges\n");
	assert.equal(n.ipRanges.running(), true);
	assert.ok(
		n.log.lines.some(
			(line) =>
				line.startsWith(`Could not write ${n.paths.ipRangesConf} at startup`) &&
				line.endsWith("the previous trusted IP ranges stay in use: nginx: [emerg] unrelated host"),
		),
	);
	// the next tick writes the file again on its own
	const [{ fn }] = [...n.clock.timers.values()];
	await fn();
	assert.ok((await lines(n.paths.ipRangesConf)).includes(CF_LINES[0]));
});

it("a refresh tick logs only a written file and restores ip_ranges.conf when nginx -t fails", async () => {
	const stored = { network: { trusted_ips: ["10.0.0.1"], trust_cloudflare: true } };
	const n = await networkSetup({ stored });
	await n.applyGroup("network", (await n.config.getRuntimeConfig("network")).values);
	await n.ipRanges.refresh();
	assert.deepEqual(n.cfNginx.calls, []);
	assert.ok(n.cfLog.lines.includes("debug: Trusted IP ranges unchanged"));
	assert.equal(n.cfLog.lines.includes("Updated trusted IP ranges"), false);

	const failing = await networkSetup({ stored, cfNginxFake: nginxFake({ testError: "nginx: [emerg] bad" }) });
	await failing.applyGroup("network", (await failing.config.getRuntimeConfig("network")).values);
	await writeFile(failing.paths.ipRangesConf, "previous\n");
	await failing.ipRanges.refresh();
	assert.equal(await readFile(failing.paths.ipRangesConf, "utf8"), "previous\n");
	assert.deepEqual(failing.cfNginx.calls, ["test"]);
	assert.ok(
		failing.cfLog.lines.some((line) =>
			line.includes("Could not update the Cloudflare IP ranges: nginx: [emerg] bad"),
		),
	);
	assert.equal(failing.cfLog.lines.includes("Updated trusted IP ranges"), false);
});

// logs: Write log files and rotations

const logValues = (overrides = {}) => ({ ...mergeRuntimeConfig("logs", {}, BOOT_ENV).values, ...overrides });

const logFiles = async (paths) => ({
	error: await readFile(paths.errorLogConf, "utf8"),
	stream: await readFile(paths.streamLogConf, "utf8"),
	access: await readFile(paths.accessLogConf, "utf8"),
});

it("logIncludes gives the error and stream log lines, off: start.sh's defaults", () => {
	assert.deepEqual(logIncludes(true), {
		error: "error_log /data/nginx/logs/error.log warn;\n",
		stream: "access_log /data/nginx/logs/stream.log slog;\n",
	});
	assert.deepEqual(logIncludes(false), {
		error: "# no error log file, errors go to stderr\n",
		stream: "access_log off;\n",
	});
});

it("start.sh writes the same include lines as logIncludes", async () => {
	const startSh = await readFile(new URL("../../rootfs/usr/local/bin/start.sh", import.meta.url), "utf8");
	for (const on of [true, false]) {
		const { error, stream } = logIncludes(on);
		assert.ok(startSh.includes(`echo "${error.trim()}" > /data/npmpro/nginx/error-log.conf`), error);
		assert.ok(startSh.includes(`echo "${stream.trim()}" > /data/npmpro/nginx/stream-log.conf`), stream);
	}
	const nginxConf = await readFile(new URL("../../rootfs/usr/local/nginx/conf/nginx.conf", import.meta.url), "utf8");
	assert.ok(hasLine(nginxConf, "include /data/npmpro/nginx/error-log.conf;"));
	assert.ok(hasLine(nginxConf, "  include /data/npmpro/nginx/stream-log.conf;"));
	assert.equal(PATHS.errorLogConf, "/data/npmpro/nginx/error-log.conf");
	assert.equal(PATHS.streamLogConf, "/data/npmpro/nginx/stream-log.conf");
	assert.equal(PATHS.logrotateConf, "/run/npmpro/logrotate");
});

it("renderRotations sets every rotate count", () => {
	assert.equal(
		renderRotations("a {\n  rotate 3\n}\nb {\n\trotate 12\n}\n", 7),
		"a {\n  rotate 7\n}\nb {\n\trotate 7\n}\n",
	);
});

it("switching Write log files on writes the three includes, tests and reloads", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = logValues();
	const result = await a.applyGroup("logs", { ...prev, write_log_files: true }, prev);
	assert.deepEqual(result, { changed: ["write_log_files"], reloaded: true });
	assert.deepEqual(await logFiles(paths), {
		...logIncludes(true),
		access: accessLogDirective(true),
	});
	assert.deepEqual(a.nginx.calls, ["test", "reload"]);
	assert.equal(await readFile(paths.logrotateConf, "utf8"), LOGROTATE);

	await a.applyGroup("logs", prev, { ...prev, write_log_files: true });
	assert.deepEqual(await logFiles(paths), { ...logIncludes(false), access: accessLogDirective(false) });
});

it("switching Write log files off keeps the access log while traffic statistics are on", async () => {
	const { paths } = await setup();
	await writeFile(paths.accessLogConf, accessLogDirective(true));
	const accessLog = createAccessLogSwitch({
		readTrafficEnabled: async () => true,
		readWriteLogFiles: async () => true,
		apply: async () => true,
	});
	const a = applier(paths, { accessLogOn: accessLog.enabled });
	const on = logValues({ write_log_files: true });
	await a.applyGroup("logs", { ...on, write_log_files: false }, on);
	assert.deepEqual(await logFiles(paths), { ...logIncludes(false), access: accessLogDirective(true) });
});

it("switching traffic statistics off keeps the access log while Write log files is on, and the reverse", async () => {
	const applied = [];
	let writeLogFiles = true;
	const accessLog = createAccessLogSwitch({
		readTrafficEnabled: async () => true,
		readWriteLogFiles: async () => writeLogFiles,
		apply: async (enabled) => applied.push(enabled),
	});
	await accessLog.onTrafficEnabledChange(false);
	writeLogFiles = false;
	await accessLog.onTrafficEnabledChange(false);
	await accessLog.onTrafficEnabledChange(true);
	assert.deepEqual(applied, [true, false, true]);
});

it("the access log switch uses the traffic value the hook applied before it is stored, in the runtime queue", async () => {
	const order = [];
	const accessLog = createAccessLogSwitch({
		readTrafficEnabled: async () => false,
		readWriteLogFiles: async () => false,
		apply: async () => order.push("apply"),
		exclusive: async (fn) => {
			order.push("enter");
			const result = await fn();
			order.push("leave");
			return result;
		},
	});
	assert.equal(await accessLog.enabled(false), false);
	assert.equal(await accessLog.enabledNow(), false);
	await accessLog.onTrafficEnabledChange(true);
	assert.deepEqual(order, ["enter", "apply", "leave"]);
	// the monitoring row still holds false: the applied value counts
	assert.equal(await accessLog.enabled(false), true);
	assert.equal(await accessLog.enabledNow(), true);
});

it("a failing hook apply keeps the previous traffic value", async () => {
	const accessLog = createAccessLogSwitch({
		readTrafficEnabled: async () => false,
		readWriteLogFiles: async () => false,
		apply: () => Promise.reject(new Error("boom")),
	});
	await assert.rejects(accessLog.onTrafficEnabledChange(true), BOOM);
	assert.equal(await accessLog.enabled(false), false);
});

it("a failing nginx -t restores all three includes and refuses the save", async () => {
	const { paths } = await setup();
	const a = applier(paths, { nginx: nginxFake({ testError: "nginx: [emerg] open() error.log failed" }) });
	const prev = logValues();
	await assert.rejects(a.applyGroup("logs", { ...prev, write_log_files: true }, prev), {
		name: "ValidationError",
		message: "nginx: [emerg] open() error.log failed",
	});
	assert.deepEqual(await logFiles(paths), { ...logIncludes(false), access: accessLogDirective(false) });
	assert.deepEqual(a.nginx.calls, ["test"]);
});

it("changing the rotations rewrites the live logrotate config without nginx", async () => {
	const { paths } = await setup();
	const a = applier(paths);
	const prev = logValues();
	const result = await a.applyGroup("logs", { ...prev, log_rotations: 14 }, prev);
	assert.deepEqual(result, { changed: ["log_rotations"], reloaded: false });
	assert.ok(hasLine(await readFile(paths.logrotateConf, "utf8"), "        rotate 14"));
	assert.deepEqual(a.nginx.calls, []);
	assert.deepEqual(await logFiles(paths), { ...logIncludes(false), access: accessLogDirective(false) });
});

it("a missing live logrotate config is skipped and logged once", async () => {
	const { paths } = await setup();
	await nodeFs.rm(paths.logrotateConf);
	const a = applier(paths);
	const prev = logValues();
	await a.applyGroup("logs", { ...prev, log_rotations: 5 }, prev);
	await a.applyGroup("logs", { ...prev, log_rotations: 6 }, { ...prev, log_rotations: 5 });
	await assert.rejects(readFile(paths.logrotateConf, "utf8"), { code: "ENOENT" });
	assert.equal(a.log.lines.filter((line) => line.includes("log rotations applies at the next")).length, 1);
});

it("startup applies stored log settings the env did not set; GOA forces the log files on", async () => {
	const { paths } = await setup();
	const config = createRuntimeConfig({
		env: { ...BOOT_ENV, NPMPRO_USER_ENV: "" },
		readStored: async (group) => (group === "logs" ? { log_rotations: 9 } : {}),
		log: quietLog(),
	});
	const a = applier(paths, { getConfig: config.getRuntimeConfig });
	assert.deepEqual(await a.applyAll(), {});
	assert.ok(hasLine(await readFile(paths.logrotateConf, "utf8"), "        rotate 9"));
	assert.deepEqual(await logFiles(paths), { ...logIncludes(false), access: accessLogDirective(false) });
	assert.deepEqual(a.nginx.calls, []);

	const goa = createRuntimeConfig({
		env: { ...BOOT_ENV, NPMPRO_USER_ENV: "", GOA: "true" },
		readStored: async (group) => (group === "logs" ? { write_log_files: false } : {}),
		log: quietLog(),
	});
	const b = applier(paths, { getConfig: goa.getRuntimeConfig });
	assert.deepEqual(await b.applyAll(), {});
	assert.deepEqual(await logFiles(paths), { ...logIncludes(true), access: accessLogDirective(true) });
	// tested, not reloaded (the startup reload follows)
	assert.deepEqual(b.nginx.calls, ["test", "test", "test"]);
});

it("at startup a failing include keeps start.sh's file and does not undo the other includes", async () => {
	const { paths } = await setup();
	const config = createRuntimeConfig({
		env: { ...BOOT_ENV, NPMPRO_USER_ENV: "" },
		readStored: async (group) => (group === "logs" ? { write_log_files: true } : {}),
		log: quietLog(),
	});
	let tests = 0;
	const nginx = {
		calls: [],
		// the error log include fails, the stream and access log includes pass
		test: () => (++tests === 1 ? Promise.reject(new Error("nginx: [emerg] x")) : Promise.resolve()),
		reload: () => Promise.resolve(),
	};
	const a = applier(paths, { getConfig: config.getRuntimeConfig, nginx });
	assert.deepEqual(Object.keys(await a.applyAll()), ["logs"]);
	assert.deepEqual(await logFiles(paths), {
		error: logIncludes(false).error,
		stream: logIncludes(true).stream,
		access: accessLogDirective(true),
	});
	assert.equal(tests, 3);
	assert.ok(a.log.lines.some((line) => line.startsWith(`Could not write ${paths.errorLogConf} at startup`)));
});
