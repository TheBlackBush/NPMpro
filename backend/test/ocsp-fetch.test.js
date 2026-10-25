import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import {
	boundedCommand,
	createOcspFetcher,
	fetchOcsp,
	MIN_INTERVAL,
	runOcspFetcher,
	staplingFileReady,
} from "../lib/ocsp-fetch.js";
import { createRuntimeApplier } from "../lib/runtime-apply.js";
import { mergeRuntimeConfig } from "../lib/runtime-rules.js";
import utils from "../lib/utils.js";

const counting = ({ hang = false, fail = false } = {}) => {
	const runs = [];
	let release;
	const run = (kind) => {
		runs.push(kind);
		if (fail) return Promise.reject(new Error("no responder"));
		if (!hang) return Promise.resolve();
		return new Promise((resolve) => {
			release = resolve;
		});
	};
	return { runs, run, release: () => release?.() };
};

const quiet = () => {
	const lines = [];
	return { lines, warn: (line) => lines.push(line), error: (line) => lines.push(line), info: () => {} };
};

it("shares a running fetch: two renders without a .der run the fetcher once", async () => {
	const f = counting({ hang: true });
	const fetch = createOcspFetcher({ run: f.run });
	const first = fetch("acme");
	const second = fetch("acme");
	assert.equal(first, second);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(fetch("acme"), first);
	f.release();
	await Promise.all([first, second]);
	assert.deepEqual(f.runs, ["acme"]);
});

it("skips a fetch within 10 minutes of the last attempt, per kind, also after a failure", async () => {
	let clock = 1_000_000;
	const f = counting({ fail: true });
	const log = quiet();
	const fetch = createOcspFetcher({ run: f.run, now: () => clock, log });
	await fetch("acme");
	clock += MIN_INTERVAL - 1;
	await fetch("acme");
	await fetch("custom");
	assert.deepEqual(f.runs, ["acme", "custom"]);
	clock += 1;
	await fetch("acme");
	assert.deepEqual(f.runs, ["acme", "custom", "acme"]);
	assert.equal(MIN_INTERVAL, 600_000);
	assert.deepEqual(log.lines, [
		"OCSP response fetch for the acme certificates failed (exit unknown)",
		"OCSP response fetch for the custom certificates failed (exit unknown)",
		"OCSP response fetch for the acme certificates failed (exit unknown)",
	]);
});

it("a forced fetch skips the 10 minute window, and waits for a run in flight before it starts a new one", async () => {
	const order = [];
	let release;
	let calls = 0;
	const fetch = createOcspFetcher({
		run: () => {
			calls++;
			order.push(`start ${calls}`);
			if (calls > 1) return Promise.resolve();
			return new Promise((resolve) => {
				release = () => {
					order.push("end 1");
					resolve();
				};
			});
		},
		log: quiet(),
	});
	const first = fetch("acme");
	await sleep(1);
	const forced = fetch("acme", { force: true });
	assert.notEqual(forced, first);
	await sleep(1);
	assert.deepEqual(order, ["start 1"]);
	release();
	await forced;
	assert.deepEqual(order, ["start 1", "end 1", "start 2"]);
	// within the window: unforced is skipped, forced runs
	await fetch("acme");
	await fetch("acme", { force: true });
	assert.equal(calls, 3);
});

it("switching stapling on within 10 minutes of a reload fetch still fetches", async () => {
	const runs = [];
	const fetch = createOcspFetcher({ run: (kind) => Promise.resolve(runs.push(kind)), log: quiet() });
	await fetch("acme"); // the reload
	await fetch("acme"); // a host render: skipped
	const dir = await mkdtemp(path.join(tmpdir(), "ocsp-apply-"));
	const conf = path.join(dir, "default-cert.conf");
	await writeFile(conf, "ssl_certificate x;\n");
	const applier = createRuntimeApplier({
		nginx: { test: () => Promise.resolve(), reload: () => Promise.resolve() },
		paths: {
			certbotIni: path.join(dir, "certbot.ini"),
			renewalDir: dir,
			crontabDir: dir,
			defaultCertConf: conf,
			tlsDir: dir,
		},
		log: quiet(),
		env: () => ({}),
		effectiveEnv: () => ({}),
		ocsp: { fetch },
	});
	const prev = { ...mergeRuntimeConfig("certificates", {}, {}).values, ocsp_stapling: false };
	await applier.applyGroup("certificates", { ...prev, ocsp_stapling: true }, prev);
	assert.deepEqual(runs, ["acme", "acme"]);
});

it("the default instance used by internalNginx is bounded", async () => {
	const first = fetchOcsp("custom");
	assert.equal(fetchOcsp("custom"), first);
	await first;
	assert.equal(fetchOcsp("custom"), first);
	const source = await readFile(path.join(import.meta.dirname, "../internal/nginx.js"), "utf8");
	assert.ok(source.includes('import { fetchOcsp, staplingFileReady } from "../lib/ocsp-fetch.js";'));
	assert.ok(source.includes("\tfetchOcsp,\n"));
	assert.ok(source.includes("fetch: internalNginx.fetchOcsp,"));
	assert.equal(source.includes("certbot-ocsp-fetcher.sh"), false);
	assert.deepEqual(boundedCommand("x", ["a"]), {
		cmd: "timeout",
		args: ["-k", "5", "60", "x", "a"],
		timeout: 70_000,
	});
	assert.equal(typeof runOcspFetcher, "function");
});

it("fetches a missing OCSP response at render only when allowed and stapling is on", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "ocsp-ready-"));
	const host = { certificate_id: 5, certificate: { provider: "letsencrypt" } };
	const on = { ACME_OCSP_STAPLING: "true" };
	const fetched = [];
	const fetch = async (kind) => {
		fetched.push(kind);
		await writeFile(path.join(dir, "certbot/live/npm-5.der"), "der");
	};
	await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(dir, "certbot/live"), { recursive: true }));
	assert.equal(await staplingFileReady(host, on, { fetchMissingOcsp: false, fetch, tlsDir: dir }), false);
	assert.equal(await staplingFileReady(host, { ACME_OCSP_STAPLING: "false" }, { fetch, tlsDir: dir }), false);
	assert.deepEqual(fetched, []);
	assert.equal(await staplingFileReady(host, on, { fetch, tlsDir: dir }), true);
	assert.equal(await staplingFileReady(host, on, { fetch, tlsDir: dir }), true);
	assert.deepEqual(fetched, ["acme"]);
	assert.equal(await staplingFileReady({ certificate_id: 0 }, on, { fetch, tlsDir: dir }), false);
});

it("a timeout stops the fetcher script and its child processes", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "ocsp-timeout-"));
	const script = path.join(dir, "fetcher.sh");
	const pidFile = path.join(dir, "child.pid");
	await writeFile(script, `#!/bin/sh\nsleep 30 &\necho $! > ${pidFile}\nwait\n`);
	await chmod(script, 0o755);
	const command = boundedCommand(script, [], { seconds: 1, killAfter: 1 });
	const started = Date.now();
	const err = await utils.execFile(command.cmd, command.args, { timeout: command.timeout }).catch((e) => e);
	assert.equal(err.name, "CommandError");
	assert.equal(err.cause.code, 124);
	assert.ok(Date.now() - started < 5000);
	const pid = (await readFile(pidFile, "utf8")).trim();
	await sleep(200);
	// gone, or a zombie waiting for its reaper
	let state = "gone";
	try {
		state = execFileSync("ps", ["-o", "stat=", "-p", pid], { encoding: "utf8" }).trim() || "gone";
	} catch {}
	assert.ok(state === "gone" || state.startsWith("Z"), `child ${pid} is ${state}`);
});

it("cuts a hanging command at the execFile timeout", async () => {
	const started = Date.now();
	await assert.rejects(utils.execFile("sleep", ["5"], { timeout: 200 }), { name: "CommandError" });
	assert.ok(Date.now() - started < 3000);
});
