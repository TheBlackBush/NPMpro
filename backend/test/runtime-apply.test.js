import assert from "node:assert/strict";
import nodeFs, { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { createRuntimeUpdater } from "../internal/runtime-update.js";
import { renderCertbotIni } from "../lib/certbot-ini.js";
import { renderDefaultCertConf } from "../lib/default-cert.js";
import { createRuntimeApplier, PATHS, testAndReload, withFiles } from "../lib/runtime-apply.js";
import { createRuntimeConfig } from "../lib/runtime-config.js";
import { mergeRuntimeConfig } from "../lib/runtime-rules.js";

const LE = "https://acme-v02.api.letsencrypt.org/directory";
const BOOT_ENV = { ACME_SERVER: LE };
const CRONTAB =
	"0 */1 * * * cron-ech.sh\n0 * * * * logrotate --state /data/nginx/logs/logrotate.state /etc/logrotate\n";

const hasLine = (text, line) => text.split("\n").includes(line);
const BOOM = /boom/u;
const EACCES = /EACCES/u;

const quietLog = () => {
	const lines = [];
	const add = (line) => lines.push(line);
	return { lines, warn: add, error: add, info: add };
};

const setup = async ({ crontab = CRONTAB, renewal = {} } = {}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "runtime-apply-"));
	const paths = {
		certbotIni: path.join(dir, "certbot.ini"),
		renewalDir: path.join(dir, "renewal"),
		crontabDir: path.join(dir, "crontabs"),
		defaultCertConf: path.join(dir, "default-cert.conf"),
		tlsDir: path.join(dir, "tls"),
	};
	await writeFile(paths.certbotIni, "old ini\n");
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
		"0 */6 * * * cron-ech.sh\n0 * * * * logrotate --state /data/nginx/logs/logrotate.state /etc/logrotate\n",
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
