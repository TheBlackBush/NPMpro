import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { runtimeExclusive } from "../internal/runtime-queue.js";
import { renderDefaultCertConf } from "../lib/default-cert.js";
import { createOcspFetcher, listResponses, staplingFileReady } from "../lib/ocsp-fetch.js";
import { createStaplingRecovery } from "../lib/stapling-recovery.js";

const STAPLES = /ssl_stapling_file/u;
const STAPLES_1 = /ssl_stapling_file .*npm-1\.der;/u;
const STAPLES_2 = /ssl_stapling_file .*npm-2\.der;/u;

const quietLog = () => {
	const lines = [];
	const add = (line) => lines.push(line);
	return { lines, warn: add, error: add, info: add, debug: add };
};

const modelOf = (rows) => ({
	query: () => ({
		where: (column, value) => ({
			withGraphFetched: () => Promise.resolve(rows.filter((row) => row[column] === value)),
		}),
	}),
});

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

const le = (id, enabled = 1) => ({ id, enabled, certificate_id: id, certificate: { provider: "letsencrypt" } });
const custom = (id) => ({ id, enabled: 1, certificate_id: id, certificate: { provider: "other" } });

const certValues = (overrides = {}) => ({
	default_certificate_id: 0,
	ocsp_stapling: true,
	custom_ocsp_stapling: false,
	...overrides,
});

/**
 * A fake host world on a temp dir: renderConfig staples like the templates (stapling on for the kind and the .der
 * file exists at render time)
 */
const world = async ({ hosts, env = { ACME_OCSP_STAPLING: "true" }, cert = certValues(), testError } = {}) => {
	const dir = await mkdtemp(path.join(tmpdir(), "stapling-recovery-"));
	const tlsDir = path.join(dir, "tls");
	await mkdir(path.join(tlsDir, "certbot/live"), { recursive: true });
	await mkdir(path.join(tlsDir, "custom"), { recursive: true });
	await mkdir(path.join(dir, "proxy_host"));
	const nginx = nginxFake({ testError });
	const log = quietLog();
	const renders = [];
	const getConfigName = (type, id) => path.join(dir, type, `${id}.conf`);
	const renderConfig = async (type, host, options) => {
		renders.push({ id: host.id, options });
		const stapling = await staplingFileReady(host, options.env, { fetchMissingOcsp: false, tlsDir });
		const der = `${tlsDir}/certbot/live/npm-${host.certificate_id}.der`;
		return `${type} ${host.id}\n${stapling ? `ssl_stapling_file ${der};\n` : ""}`;
	};
	const defaultCertConf = path.join(dir, "default-cert.conf");
	await writeFile(defaultCertConf, renderDefaultCertConf(null, tlsDir));
	const recovery = createStaplingRecovery({
		hostTypes: [[modelOf(hosts), "proxy_host", "certificate"]],
		getConfigName,
		renderConfig,
		nginx,
		exclusive: runtimeExclusive,
		effectiveEnv: () => env,
		getConfig: async () => ({ values: cert }),
		listCertificates: async () => [{ id: 9 }],
		tlsDir,
		defaultCertConf,
		log,
	});
	// a first render (bulk regeneration) writes the configs as they are now
	const firstRender = async () => {
		for (const host of hosts.filter((entry) => entry.enabled)) {
			await writeFile(getConfigName("proxy_host", host.id), await renderConfig("proxy_host", host, { env }));
		}
	};
	const addDer = (id, kind = "certbot/live") => writeFile(path.join(tlsDir, kind, `npm-${id}.der`), "der");
	const conf = (id) => readFile(getConfigName("proxy_host", id), "utf8");
	return { dir, tlsDir, nginx, log, renders, recovery, firstRender, addDer, conf, defaultCertConf };
};

it("re-renders hosts whose .der appeared after the first render, with one nginx -t and one reload", async () => {
	const w = await world({ hosts: [le(1), le(2), le(3, 0), custom(4)] });
	await w.firstRender();
	assert.doesNotMatch(await w.conf(1), STAPLES);
	await w.addDer(1);
	await w.addDer(2);
	await w.addDer(3);
	await w.addDer(4, "custom");
	w.renders.length = 0;

	const written = await w.recovery.recover();
	assert.deepEqual(written, [path.join(w.dir, "proxy_host/1.conf"), path.join(w.dir, "proxy_host/2.conf")]);
	assert.match(await w.conf(1), STAPLES_1);
	assert.match(await w.conf(2), STAPLES_2);
	// 3 is disabled, 4 is a custom certificate with custom stapling off
	assert.deepEqual(
		w.renders.map(({ id }) => id),
		[1, 2],
	);
	assert.equal(w.renders[0].options.fetchMissingOcsp, false);
	assert.deepEqual(w.nginx.calls, ["test", "reload"]);

	// nothing left to do: no render, no reload
	w.renders.length = 0;
	assert.deepEqual(await w.recovery.recover(), []);
	assert.deepEqual(w.renders, []);
	assert.deepEqual(w.nginx.calls, ["test", "reload"]);
});

it("leaves hosts without a .der, without a config file or with stapling off alone", async () => {
	const w = await world({ hosts: [le(1), le(2)] });
	await w.firstRender();
	await w.addDer(2);
	await writeFile(path.join(w.dir, "proxy_host/2.conf.err"), "x");
	await rm(path.join(w.dir, "proxy_host/2.conf"));
	assert.deepEqual(await w.recovery.recover(), []);
	assert.deepEqual(w.nginx.calls, []);

	const off = await world({ hosts: [le(1)], env: { ACME_OCSP_STAPLING: "false" } });
	await off.firstRender();
	await off.addDer(1);
	assert.deepEqual(await off.recovery.recover(), []);
	assert.deepEqual(off.renders.length, 1);
});

it("a host whose new render still has no stapling is not written and not retried in a loop", async () => {
	// a template that does not staple (the render disagrees with the file check)
	const w2 = await world({ hosts: [le(1)] });
	await w2.firstRender();
	await w2.addDer(1);
	const noStaple = createStaplingRecovery({
		hostTypes: [[modelOf([le(1)]), "proxy_host", "certificate"]],
		getConfigName: (type, id) => path.join(w2.dir, type, `${id}.conf`),
		renderConfig: async () => "proxy_host 1\n",
		nginx: w2.nginx,
		exclusive: runtimeExclusive,
		effectiveEnv: () => ({ ACME_OCSP_STAPLING: "true" }),
		getConfig: async () => ({ values: certValues() }),
		tlsDir: w2.tlsDir,
		defaultCertConf: w2.defaultCertConf,
		log: w2.log,
	});
	assert.deepEqual(await noStaple.recover(), []);
	assert.deepEqual(w2.nginx.calls, []);
});

it("a failing nginx -t puts the previous configs back and is logged, recover does not throw", async () => {
	const w = await world({ hosts: [le(1)], testError: "nginx: [emerg] stapling" });
	await w.firstRender();
	const before = await w.conf(1);
	await w.addDer(1);
	assert.deepEqual(await w.recovery.recover(), []);
	assert.equal(await w.conf(1), before);
	assert.deepEqual(w.nginx.calls, ["test"]);
	assert.ok(w.log.lines.some((line) => line.startsWith("Could not turn OCSP stapling on") && line.includes("emerg")));
});

it("staples the default certificate include once its .der exists", async () => {
	const w = await world({ hosts: [], cert: certValues({ default_certificate_id: 9 }) });
	const live = path.join(w.tlsDir, "certbot/live/npm-9");
	await mkdir(live);
	await writeFile(path.join(live, "fullchain.pem"), "chain");
	await writeFile(path.join(live, "privkey.pem"), "key");
	// written without stapling (no .der yet)
	const withoutDer = { cert: `${live}/fullchain.pem`, key: `${live}/privkey.pem`, stapling: null };
	await writeFile(w.defaultCertConf, renderDefaultCertConf(withoutDer, w.tlsDir));
	assert.deepEqual(await w.recovery.recover(), []);
	await w.addDer(9);
	assert.deepEqual(await w.recovery.recover(), [w.defaultCertConf]);
	assert.equal(
		await readFile(w.defaultCertConf, "utf8"),
		renderDefaultCertConf({ ...withoutDer, stapling: `${w.tlsDir}/certbot/live/npm-9.der` }, w.tlsDir),
	);
	assert.deepEqual(w.nginx.calls, ["test", "reload"]);
});

it("the fetcher announces new .der files without waiting for the listener, and only new ones", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "ocsp-list-"));
	const dirs = { acme: dir };
	await writeFile(path.join(dir, "npm-1.der"), "old");
	await writeFile(path.join(dir, "npm-3.der"), "");
	let makes = ["npm-2.der", "npm-3.der"];
	const fetch = createOcspFetcher({
		run: async () => {
			for (const name of makes) await writeFile(path.join(dir, name), "der");
		},
		listResponses: (kind) => listResponses(kind, { dirs }),
		minInterval: 0,
		log: quietLog(),
	});
	const heard = [];
	// a listener that never settles must not hold the fetch
	fetch.onNewResponses((kind, names) => {
		heard.push([kind, names.toSorted((a, b) => a.localeCompare(b))]);
		return new Promise(() => {});
	});
	await fetch("acme");
	assert.deepEqual(heard, [["acme", ["npm-2.der", "npm-3.der"]]]);
	makes = ["npm-1.der"];
	await sleep(1);
	await fetch("acme");
	assert.equal(heard.length, 1);
});

it("a fetch inside a queued job queues the recovery behind it instead of deadlocking", async () => {
	const w = await world({ hosts: [le(1)] });
	await w.firstRender();
	const fetch = createOcspFetcher({
		run: () => w.addDer(1),
		listResponses: (kind) => listResponses(kind, { dirs: { acme: path.join(w.tlsDir, "certbot/live") } }),
		log: quietLog(),
	});
	let recovered;
	fetch.onNewResponses(() => {
		recovered = w.recovery.recover();
	});
	// a host save in the queue whose render fetched the missing response
	await runtimeExclusive(() => fetch("acme"));
	assert.ok(recovered);
	assert.deepEqual(await recovered, [path.join(w.dir, "proxy_host/1.conf")]);
	assert.match(await w.conf(1), STAPLES);
});
