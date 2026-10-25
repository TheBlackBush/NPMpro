import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { runtimeView } from "../internal/runtime-update.js";
import { createRuntimeApplier } from "../lib/runtime-apply.js";
import {
	buildEffectiveEnv,
	mergeRuntimeConfig,
	RUNTIME_ENV_NAMES,
	renderStartupSettings,
	restartPendingOf,
	userSetEnvNames,
} from "../lib/runtime-rules.js";
import { isTimeZone, isZoneName, listTimeZones } from "../lib/time-zones.js";

const BIN = new URL("../../rootfs/usr/local/bin/", import.meta.url);
const HELPER = new URL("startup-settings.sh", BIN).pathname;
const TZIF = "TZif2 fake zone data";
const BOOT_ENV = { NPMPRO_USER_ENV: "PATH", TZ: "UTC", GOA: "false" };
const userEnv = (vars) => ({ ...BOOT_ENV, ...vars, NPMPRO_USER_ENV: `PATH ${Object.keys(vars).join(" ")}` });
const HAS_ZONEINFO = existsSync("/usr/share/zoneinfo/Europe/Berlin");

const zoneinfo = async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "zoneinfo-"));
	for (const name of [
		"UTC",
		"Europe/Berlin",
		"America/Argentina/Buenos_Aires",
		"Etc/GMT+1",
		"posix/UTC",
		"right/UTC",
	]) {
		await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
		await writeFile(path.join(dir, name), TZIF);
	}
	await writeFile(path.join(dir, "zone1970.tab"), "# not a zone\n");
	await writeFile(path.join(dir, "leapseconds"), "# not a zone\n");
	await writeFile(path.join(dir, "Empty"), "");
	await symlink("Europe/Berlin", path.join(dir, "Berlin"));
	return dir;
};

// runs the shell helper like envs.sh does and prints its findings
const parse = (file, dir) => {
	const out = spawnSync(
		"sh",
		[
			"-c",
			'. "$HELPER"; startup_settings_warn "$F" "$Z"; printf "TZ=[%s] GOA=[%s]" "$(startup_setting "$F" TZ "$Z")" "$(startup_setting "$F" GOA "$Z")"',
		],
		{
			env: { PATH: process.env.PATH, HELPER, F: file, Z: dir },
			encoding: "utf8",
		},
	);
	assert.equal(out.status, 0, out.stderr);
	return out.stdout;
};

it("lists the zone names of the zoneinfo folder without posix/, right/ and non-zone files", async () => {
	const dir = await zoneinfo();
	assert.deepEqual(await listTimeZones({ dir }), [
		"America/Argentina/Buenos_Aires",
		"Berlin",
		"Etc/GMT+1",
		"Europe/Berlin",
		"UTC",
	]);
	assert.equal(isTimeZone("Europe/Berlin", dir), true);
	for (const name of [
		"posix/UTC",
		"right/UTC",
		"zone1970.tab",
		"leapseconds",
		"Empty",
		"Europe",
		"../UTC",
		"",
		"Nope/X",
	]) {
		assert.equal(isTimeZone(name, dir), false, name);
	}
	assert.equal(isZoneName("Europe/Berlin;rm"), false);
	assert.equal(isZoneName("a".repeat(65)), false);
	assert.deepEqual(await listTimeZones({ dir: path.join(dir, "missing") }), []);
});

it("validates the time zone setting against the image zoneinfo", { skip: !HAS_ZONEINFO }, () => {
	const { values, invalid } = mergeRuntimeConfig("advanced", { time_zone: "Nope/Zone" }, BOOT_ENV);
	assert.equal(values.time_zone, "UTC");
	assert.deepEqual(invalid, [{ key: "time_zone", source: "stored" }]);
	assert.equal(
		mergeRuntimeConfig("advanced", { time_zone: "Europe/Berlin" }, BOOT_ENV).values.time_zone,
		"Europe/Berlin",
	);
});

it("lets TZ and GOA from the env win and lock, and keeps them out of NPMPRO_RUNTIME_ENVS and the effective env", () => {
	const env = userEnv({ TZ: "Europe/Paris", GOA: "true" });
	const advanced = mergeRuntimeConfig("advanced", { time_zone: "UTC" }, env);
	assert.equal(advanced.values.time_zone, "Europe/Paris");
	assert.deepEqual(advanced.locked, ["time_zone"]);
	assert.deepEqual(advanced.locked_by, { time_zone: "TZ" });
	const logs = mergeRuntimeConfig("logs", { goaccess: false }, env);
	assert.equal(logs.values.goaccess, true);
	assert.ok(logs.locked.includes("goaccess"));
	assert.ok(userSetEnvNames(env).has("TZ"));
	assert.equal(RUNTIME_ENV_NAMES.includes("TZ"), false);
	assert.equal(RUNTIME_ENV_NAMES.includes("GOA"), false);
	// the running values stay: a saved time zone only applies after a restart
	const out = buildEffectiveEnv(BOOT_ENV, {
		advanced: { values: { time_zone: "Europe/Berlin", config_beautifier: true, gravatar: true } },
		logs: { values: { goaccess: true, write_log_files: false, log_rotations: 3 } },
	});
	assert.equal(out.TZ, "UTC");
	assert.equal(out.GOA, "false");
});

it("reports the restart settings saved with another value than the container runs with", () => {
	assert.deepEqual(restartPendingOf("advanced", { time_zone: "Europe/Berlin" }, [], BOOT_ENV), ["time_zone"]);
	assert.deepEqual(restartPendingOf("advanced", { time_zone: "UTC" }, [], BOOT_ENV), []);
	// without TZ in the env the container runs with UTC
	assert.deepEqual(restartPendingOf("advanced", { time_zone: "UTC" }, [], { NPMPRO_USER_ENV: "" }), []);
	assert.deepEqual(restartPendingOf("logs", { goaccess: true }, [], BOOT_ENV), ["goaccess"]);
	assert.deepEqual(restartPendingOf("logs", { goaccess: true }, ["goaccess"], BOOT_ENV), []);
	assert.deepEqual(restartPendingOf("network", { trusted_ips: [] }, [], BOOT_ENV), []);
	const view = runtimeView("advanced", mergeRuntimeConfig("advanced", {}, BOOT_ENV), {
		...BOOT_ENV,
		TZ: "Asia/Tokyo",
	});
	assert.deepEqual(view.restart_pending, ["time_zone"]);
	assert.equal(view.applies.time_zone, "restart");
});

it("renders the startup settings without the variables the env sets", () => {
	const values = { advanced: { time_zone: "Europe/Berlin" }, logs: { goaccess: true } };
	const all = renderStartupSettings(values, BOOT_ENV);
	assert.ok(all.startsWith("# "));
	assert.deepEqual(all.split("\n").slice(1), ["GOA=true", "TZ=Europe/Berlin", ""]);
	const tzFromEnv = renderStartupSettings(values, userEnv({ TZ: "Europe/Paris" }));
	assert.deepEqual(tzFromEnv.split("\n").slice(1), ["GOA=true", ""]);
});

it("reads only valid lines with the shell helper, never running the file", async () => {
	const dir = await zoneinfo();
	const work = await mkdtemp(path.join(tmpdir(), "startup-settings-"));
	const file = path.join(work, "startup-settings.env");
	const marker = path.join(work, "ran");
	await writeFile(
		file,
		[
			"# comment",
			"",
			"TZ=Europe/Berlin",
			"GOA=yes",
			"TZ=../../etc/passwd",
			`TZ=$(touch ${marker})`,
			`GOA=true; touch ${marker}`,
			"TZ=Nope/Zone",
			"TZ=posix/../UTC",
			"export GOA=true",
			"GOA=true",
		].join("\n"),
	);
	const out = parse(file, dir);
	assert.ok(out.endsWith("TZ=[Europe/Berlin] GOA=[true]"), out);
	assert.equal((out.match(/Ignoring line/gu) ?? []).length, 7, out);
	assert.equal(out.includes("passwd"), false);
	assert.equal(existsSync(marker), false);
	// a missing file sets nothing
	assert.equal(parse(path.join(work, "missing"), dir), "TZ=[] GOA=[]");
	// what the backend writes, the shell reads back
	await writeFile(
		file,
		renderStartupSettings({ advanced: { time_zone: "Etc/GMT+1" }, logs: { goaccess: false } }, BOOT_ENV),
	);
	assert.equal(parse(file, dir), "TZ=[Etc/GMT+1] GOA=[false]");
});

it("writes the startup settings file on save of a restart setting, with the other group as it is, without nginx", async () => {
	const work = await mkdtemp(path.join(tmpdir(), "startup-apply-"));
	const file = path.join(work, "startup-settings.env");
	const nginxCalls = [];
	const applier = createRuntimeApplier({
		nginx: { test: async () => nginxCalls.push("test"), reload: async () => nginxCalls.push("reload") },
		paths: { startupSettings: file },
		env: () => BOOT_ENV,
		effectiveEnv: () => BOOT_ENV,
		getConfig: async (group) => ({ values: mergeRuntimeConfig(group, { goaccess: true }, BOOT_ENV).values }),
		log: { warn: () => {}, error: () => {}, info: () => {} },
	});
	const prev = mergeRuntimeConfig("advanced", {}, BOOT_ENV).values;
	const next = { ...prev, time_zone: "Europe/Berlin" };
	await applier.applyGroup("advanced", next, prev);
	assert.deepEqual((await readFile(file, "utf8")).split("\n").slice(1), ["GOA=true", "TZ=Europe/Berlin", ""]);
	assert.deepEqual(nginxCalls, []);
	// another advanced key leaves the file alone
	await writeFile(file, "kept\n");
	await applier.applyGroup("advanced", { ...next, gravatar: false }, next);
	assert.equal(await readFile(file, "utf8"), "kept\n");
});

it("reads the startup settings in envs.sh after NPMPRO_USER_ENV and before the TZ and GOA defaults and checks", () => {
	const text = readFileSync(new URL("envs.sh", BIN), "utf8");
	const at = (needle) => {
		const index = text.indexOf(needle);
		assert.notEqual(index, -1, needle);
		return index;
	};
	const read = at(". /usr/local/bin/startup-settings.sh");
	assert.ok(at("export NPMPRO_USER_ENV") < read);
	assert.ok(read < at('export GOA="${GOA:-false}"'));
	assert.ok(read < at('if [ -z "$TZ" ] || [ ! -s /usr/share/zoneinfo/"$TZ" ]; then'));
	assert.ok(at('export TZ="${TZ:-UTC}"') < at('if [ -z "$TZ" ] || [ ! -s /usr/share/zoneinfo/"$TZ" ]; then'));
	assert.equal(text.includes(". /data/npmpro/startup-settings.env"), false);
	const health = readFileSync(new URL("healthcheck.sh", BIN), "utf8");
	assert.ok(health.includes(". /usr/local/bin/startup-settings.sh"));
	// the snapshot of the running GOA lives outside the folders start.sh hands to PUID, replaced by a rename
	assert.ok(health.includes("startup_setting /etc/npmpro/startup-settings.env GOA"));
	assert.ok(text.includes('mv -f "$startup_snapshot" /etc/npmpro/startup-settings.env'));
	assert.equal(text.includes("/run/npmpro/startup-settings.env"), false);
	const start = readFileSync(new URL("start.sh", BIN), "utf8");
	const chownBlock = start.slice(start.indexOf("find /usr/local"), start.indexOf('chown -h "$PUID:$PGID"'));
	assert.ok(chownBlock.includes("/run"));
	assert.equal(chownBlock.includes("/etc"), false);
	// the paths come from the callers, never from the environment
	const helper = readFileSync(HELPER, "utf8");
	assert.equal(helper.includes("STARTUP_SETTINGS_FILE"), false);
	assert.equal(helper.includes("STARTUP_SETTINGS_ZONEINFO"), false);
});

it("does not read a startup settings file that is a link, not a regular file or larger than 4096 bytes", async () => {
	const dir = await zoneinfo();
	const work = await mkdtemp(path.join(tmpdir(), "startup-guard-"));
	const real = path.join(work, "real.env");
	await writeFile(real, "GOA=true\nTZ=UTC\n");
	assert.equal(parse(real, dir), "TZ=[UTC] GOA=[true]");
	const link = path.join(work, "link.env");
	await symlink(real, link);
	const linked = parse(link, dir);
	assert.ok(linked.endsWith("TZ=[] GOA=[]"), linked);
	assert.match(linked, /is not a regular file/u);
	const big = path.join(work, "big.env");
	await writeFile(big, `GOA=true\n${"#".repeat(4096)}\n`);
	const tooBig = parse(big, dir);
	assert.ok(tooBig.endsWith("TZ=[] GOA=[]"), tooBig);
	assert.equal((tooBig.match(/larger than 4096 bytes/gu) ?? []).length, 1);
	const fifo = path.join(work, "fifo.env");
	assert.equal(spawnSync("mkfifo", [fifo]).status, 0);
	assert.ok(parse(fifo, dir).endsWith("TZ=[] GOA=[]"));
	assert.ok(parse(work, dir).endsWith("TZ=[] GOA=[]"));
});

it("accepts in the shell exactly the zones the backend accepts", async () => {
	const dir = await zoneinfo();
	await writeFile(path.join(dir, "NoMagic"), "not a tzif file");
	await writeFile(path.join(dir, "posixrules"), TZIF);
	await writeFile(path.join(dir, "Factory"), TZIF);
	const work = await mkdtemp(path.join(tmpdir(), "startup-zones-"));
	const file = path.join(work, "startup-settings.env");
	for (const zone of [
		"UTC",
		"Europe/Berlin",
		"Berlin",
		"Etc/GMT+1",
		"posix/UTC",
		"right/UTC",
		"posixrules",
		"Factory",
		"NoMagic",
		"Empty",
		"zone1970.tab",
		"Europe",
	]) {
		await writeFile(file, `TZ=${zone}\n`);
		const shell = parse(file, dir).endsWith(`TZ=[${zone}] GOA=[]`);
		assert.equal(shell, isTimeZone(zone, dir), zone);
	}
});

it("writes the startup settings file at startup even when nginx -t fails on the log includes and hosts", async () => {
	const work = await mkdtemp(path.join(tmpdir(), "startup-order-"));
	const file = path.join(work, "startup-settings.env");
	await mkdir(path.join(work, "nginx", "logs"), { recursive: true });
	const paths = {
		startupSettings: file,
		errorLogConf: path.join(work, "error-log.conf"),
		streamLogConf: path.join(work, "stream-log.conf"),
		accessLogConf: path.join(work, "access-log.conf"),
		logrotateConf: path.join(work, "logrotate"),
		nginxDir: path.join(work, "nginx"),
	};
	const host = path.join(work, "1.conf");
	const errors = [];
	const applier = createRuntimeApplier({
		nginx: { test: async () => Promise.reject(new Error("nginx -t failed")), reload: async () => {} },
		paths,
		env: () => BOOT_ENV,
		effectiveEnv: () => BOOT_ENV,
		getConfig: async (group) => ({ values: mergeRuntimeConfig(group, { time_zone: "UTC" }, BOOT_ENV).values }),
		renderHosts: async () => [{ path: host, content: "server {}\n", nginx: true }],
		log: { warn: () => {}, error: (line) => errors.push(line), info: () => {} },
	});
	const values = { ...mergeRuntimeConfig("logs", {}, BOOT_ENV).values, write_log_files: true, goaccess: true };
	await assert.rejects(applier.applyGroup("logs", values), /nginx -t failed/u);
	assert.deepEqual((await readFile(file, "utf8")).split("\n").slice(1), ["GOA=true", "TZ=UTC", ""]);
	// the nginx files were put back
	assert.equal(existsSync(host), false);
	assert.ok(errors.length > 0);
});
