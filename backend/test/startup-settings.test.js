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
const GOACCESS_DEFAULT_LINES = [
	"goaccess_keep_days=30",
	"goaccess_anonymize=1",
	"goaccess_drop_query_strings=true",
	"goaccess_real_os=true",
	"goaccess_resolve_hosts=true",
];
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
	assert.deepEqual((await readFile(file, "utf8")).split("\n").slice(1), [
		"GOA=true",
		...GOACCESS_DEFAULT_LINES,
		"TZ=Europe/Berlin",
		"",
	]);
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
	// Docker runs the healthcheck as root: it reads only the root-owned snapshot, never /data, and never sources a file
	assert.equal(health.includes("/data/"), false);
	assert.equal(/^\s*\.\s/mu.test(health), false);
	assert.ok(health.includes("done < /etc/npmpro/healthcheck.env"));
	assert.ok(text.includes('mv -f "$healthcheck_snapshot" /etc/npmpro/healthcheck.env'));
	assert.equal(text.includes("/run/npmpro/startup-settings.env"), false);
	// root never chowns the image code or the contents of /run and /tmp
	const start = readFileSync(new URL("start.sh", BIN), "utf8");
	assert.equal(start.includes("find /usr/local "), false);
	assert.equal(/chown -R "\$PUID/u.test(start), false);
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
	assert.deepEqual((await readFile(file, "utf8")).split("\n").slice(1), [
		"GOA=true",
		...GOACCESS_DEFAULT_LINES,
		"TZ=UTC",
		"",
	]);
	// the nginx files were put back
	assert.equal(existsSync(host), false);
	assert.ok(errors.length > 0);
});

// GOACLA as envs.sh builds it from the startup settings file
const composeGoacla = (file) => {
	const out = spawnSync("sh", ["-c", '. "$HELPER"; startup_settings_goacla "$F"'], {
		env: { PATH: process.env.PATH, HELPER, F: file },
		encoding: "utf8",
	});
	assert.equal(out.status, 0, out.stderr);
	return out.stdout;
};

it("builds GOACLA from the GoAccess options with the default of envs.sh when nothing is saved", async () => {
	const text = readFileSync(new URL("envs.sh", BIN), "utf8");
	const fallback = /^export GOACLA="\$\{GOACLA:-"(?<value>[^"]+)"\}"$/mu.exec(text)?.groups.value;
	assert.ok(fallback);
	const work = await mkdtemp(path.join(tmpdir(), "goacla-"));
	const file = path.join(work, "startup-settings.env");
	assert.equal(composeGoacla(path.join(work, "missing")), fallback);
	// what the backend writes with the defaults gives the same string
	const defaults = mergeRuntimeConfig("logs", {}, BOOT_ENV).values;
	await writeFile(file, renderStartupSettings({ logs: defaults }, BOOT_ENV));
	assert.equal(composeGoacla(file), fallback);
	// the backend reads its own defaults back from that string
	const parsed = mergeRuntimeConfig("logs", {}, userEnv({ GOACLA: fallback })).values;
	for (const key of Object.keys(defaults).filter((name) => name.startsWith("goaccess_"))) {
		assert.deepEqual(parsed[key], defaults[key], key);
	}
	// composed before the charset check and the GeoIP append, only without GOACLA from the env
	const compose = text.indexOf('GOACLA="$(startup_settings_goacla /data/npmpro/startup-settings.env)"');
	assert.ok(text.indexOf("export NPMPRO_USER_ENV") < compose);
	assert.ok(compose < text.indexOf('if echo "$GOACLA" | grep -vq "geoip-database"; then'));
	assert.ok(compose < text.indexOf('if [ -n "$GOACLA" ] && ! echo "$GOACLA" | grep -q'));
});

it("maps each GoAccess option to fixed flags and ignores bad values", async () => {
	const work = await mkdtemp(path.join(tmpdir(), "goacla-"));
	const file = path.join(work, "startup-settings.env");
	const values = {
		...mergeRuntimeConfig("logs", {}, BOOT_ENV).values,
		goaccess_keep_days: 366,
		goaccess_anonymize: "off",
		goaccess_drop_query_strings: false,
		goaccess_real_os: false,
		goaccess_resolve_hosts: false,
	};
	await writeFile(file, renderStartupSettings({ logs: values }, BOOT_ENV));
	assert.equal(composeGoacla(file), "--agent-list --double-decode --keep-last=366");
	await writeFile(file, "goaccess_anonymize=3\ngoaccess_keep_days=7\n");
	assert.equal(
		composeGoacla(file),
		"--agent-list --real-os --double-decode --anonymize-ip --anonymize-level=3 --keep-last=7 --with-output-resolver --no-query-string",
	);
	const marker = path.join(work, "ran");
	const bad = [
		"goaccess_keep_days=0",
		"goaccess_keep_days=367",
		"goaccess_keep_days=030",
		"goaccess_keep_days=1000",
		"goaccess_keep_days=30 --log-file=/etc/shadow",
		"goaccess_anonymize=4",
		"goaccess_anonymize=on",
		"goaccess_real_os=yes",
		`goaccess_resolve_hosts=$(touch ${marker})`,
		"goaccess_drop_query_strings=TRUE",
		"goaccess_output=/tmp/x",
	];
	await writeFile(file, `${bad.join("\n")}\n`);
	const out = spawnSync("sh", ["-c", '. "$HELPER"; startup_settings_warn "$F"; startup_settings_goacla "$F"'], {
		env: { PATH: process.env.PATH, HELPER, F: file },
		encoding: "utf8",
	});
	assert.equal(out.status, 0, out.stderr);
	assert.equal((out.stdout.match(/Ignoring line/gu) ?? []).length, bad.length, out.stdout);
	assert.ok(
		out.stdout.endsWith(
			"--agent-list --real-os --double-decode --anonymize-ip --anonymize-level=1 --keep-last=30 --with-output-resolver --no-query-string",
		),
	);
	assert.equal(out.stdout.includes("shadow"), false);
	assert.equal(existsSync(marker), false);
});

it("locks every GoAccess option with a GOACLA from the user and reads the values from it", () => {
	const env = userEnv({ GOACLA: "--keep-last 90 --anonymize-ip --anonymize-level=2 --real-os" });
	const {
		values,
		locked,
		locked_by: lockedBy,
		locked_reason: lockedReason,
	} = mergeRuntimeConfig("logs", { goaccess_keep_days: 5, goaccess_real_os: false }, env);
	const keys = [
		"goaccess_keep_days",
		"goaccess_anonymize",
		"goaccess_drop_query_strings",
		"goaccess_real_os",
		"goaccess_resolve_hosts",
	];
	for (const key of keys) {
		assert.ok(locked.includes(key), key);
		assert.equal(lockedBy[key], "GOACLA");
		assert.equal(lockedReason[key], undefined);
	}
	assert.equal(values.goaccess_keep_days, 90);
	assert.equal(values.goaccess_anonymize, "2");
	assert.equal(values.goaccess_real_os, true);
	assert.equal(values.goaccess_drop_query_strings, false);
	assert.equal(values.goaccess_resolve_hosts, false);
	assert.equal(mergeRuntimeConfig("logs", {}, userEnv({ GOACLA: "--agent-list" })).values.goaccess_keep_days, null);
	assert.equal(mergeRuntimeConfig("logs", {}, userEnv({ GOACLA: "--anonymize-ip" })).values.goaccess_anonymize, "1");
	// not written to the startup settings file while GOACLA comes from the env
	const content = renderStartupSettings({ logs: values }, env);
	assert.equal(content.includes("goaccess_"), false);
	// the GOACLA envs.sh built (not user-set) is the running value: no restart pending for matching stored values
	const running = { ...BOOT_ENV, GOACLA: "--agent-list --double-decode --keep-last=7" };
	const stored = { goaccess_keep_days: 7, goaccess_anonymize: "off", goaccess_real_os: false };
	const merged = mergeRuntimeConfig("logs", { ...stored, goaccess_drop_query_strings: false }, running);
	assert.deepEqual(restartPendingOf("logs", merged.values, merged.locked, running), ["goaccess_resolve_hosts"]);
});
