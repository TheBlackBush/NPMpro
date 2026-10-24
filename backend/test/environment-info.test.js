import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { ENVIRONMENT_GROUPS, ENVIRONMENT_ITEMS, environmentInfo } from "../lib/environment-info.js";
import { RUNTIME_ENV_NAMES, userSetEnvNames } from "../lib/runtime-rules.js";

const RUNTIME_LINE = /^NPMPRO_RUNTIME_ENVS="(?<names>[^"]*)"$/mu;
const STARTUP_LINE = /^NPMPRO_STARTUP_ENVS="(?<names>[^"]*)"$/mu;
const ENVS_SH = new URL("../../rootfs/usr/local/bin/envs.sh", import.meta.url);
const SECRET_NAMES = ["DB_MYSQL_PASSWORD", "DB_POSTGRES_PASSWORD", "INITIAL_ADMIN_PASSWORD", "ACME_EAB_HMAC_KEY"];
const sorted = (list) => [...list].sort((a, b) => a.localeCompare(b));
const itemOf = (info, name) => info.groups.flatMap((group) => group.items).find((entry) => entry.name === name);

it("never returns a value for a secret item, set or not", () => {
	const env = Object.fromEntries(SECRET_NAMES.map((name) => [name, "hunter2"]));
	for (const source of [env, {}]) {
		const info = environmentInfo(source, []);
		for (const name of SECRET_NAMES) {
			const entry = itemOf(info, name);
			assert.equal(entry.secret, true);
			assert.equal(Object.hasOwn(entry, "value"), false, name);
			assert.equal(entry.default, null);
			assert.equal(entry.set, source === env);
		}
		assert.equal(JSON.stringify(info).includes("hunter2"), false);
	}
});

it("keeps the Global Constraints secrets secret", () => {
	for (const item of ENVIRONMENT_ITEMS) {
		if (/PASSWORD|SECRET|_KEY(_|$)/u.test(item.name)) assert.equal(item.secret, true, item.name);
	}
});

it("reports set from the user list and is_default when unset or equal to the default", () => {
	const env = { NPMPRO_USER_ENV: "HTTP_PORT HTTPS_PORT", HTTP_PORT: "8080", HTTPS_PORT: "443", NPM_PORT: "81" };
	const info = environmentInfo(env, []);
	assert.deepEqual(itemOf(info, "HTTP_PORT"), {
		name: "HTTP_PORT",
		value: "8080",
		default: "80",
		is_default: false,
		secret: false,
		set: true,
	});
	assert.equal(itemOf(info, "HTTPS_PORT").is_default, true);
	assert.equal(itemOf(info, "HTTPS_PORT").set, true);
	// filled in by envs.sh, not set by the user
	const filled = itemOf(info, "NPM_PORT");
	assert.equal(filled.set, false);
	assert.equal(filled.is_default, true);
	assert.equal(filled.value, "81");
});

it("shows the default value of an unset item", () => {
	const entry = itemOf(environmentInfo({}, []), "NGINX_WORKER_PROCESSES");
	assert.equal(entry.value, "auto");
	assert.equal(entry.set, false);
	assert.equal(entry.is_default, true);
});

it("puts every item in a known group, without duplicates or runtime names", () => {
	const names = ENVIRONMENT_ITEMS.map((entry) => entry.name);
	assert.equal(new Set(names).size, names.length);
	for (const entry of ENVIRONMENT_ITEMS) {
		assert.ok(ENVIRONMENT_GROUPS.includes(entry.group), entry.name);
		assert.equal(entry.description_key, `environment.${entry.group}.${entry.name}`);
		assert.equal(RUNTIME_ENV_NAMES.includes(entry.name), false, entry.name);
	}
	const info = environmentInfo({}, []);
	assert.deepEqual(
		info.groups.map((group) => group.id),
		ENVIRONMENT_GROUPS,
	);
	assert.equal(info.groups.flatMap((group) => group.items).length, names.length);
});

it("lists the locked runtime settings with their env var", () => {
	const info = environmentInfo({}, [
		{ group: "certificates", key: "key_type" },
		{ group: "logs", key: "write_log_files" },
	]);
	assert.deepEqual(info.locked_runtime, [
		{ group: "certificates", key: "key_type", env: "ACME_KEY_TYPE" },
		{ group: "logs", key: "write_log_files", env: "LOGROTATE" },
	]);
	assert.deepEqual(environmentInfo({}, undefined).locked_runtime, []);
});

it("names the variable that actually locks a runtime setting (locked_by)", () => {
	const info = environmentInfo({}, [
		{ group: "certificates", key: "key_type", env: "ACME_KEY_SIZE" },
		{ group: "certificates", key: "must_staple", env: "ACME_OCSP_STAPLING" },
		{ group: "logs", key: "write_log_files", env: "GOA" },
	]);
	assert.deepEqual(
		info.locked_runtime.map(({ key, env }) => [key, env]),
		[
			["key_type", "ACME_KEY_SIZE"],
			["must_staple", "ACME_OCSP_STAPLING"],
			["write_log_files", "GOA"],
		],
	);
});

it("lists the runtime and environment names once in envs.sh", () => {
	const text = readFileSync(ENVS_SH, "utf8");
	const runtime = RUNTIME_LINE.exec(text)?.groups.names.split(" ") ?? [];
	const startup = STARTUP_LINE.exec(text)?.groups.names.split(" ") ?? [];
	const names = [...runtime, ...startup];
	assert.equal(new Set(names).size, names.length);
	assert.deepEqual(sorted(runtime), sorted(RUNTIME_ENV_NAMES));
	assert.deepEqual(sorted(startup), sorted(ENVIRONMENT_ITEMS.map((entry) => entry.name)));
});

it("envs.sh hashes only the runtime vars the env sets: startup vars like TZ or PUID do not regenerate hosts", () => {
	const text = readFileSync(ENVS_SH, "utf8");
	const block = text.slice(
		text.indexOf("NPMPRO_RUNTIME_ENVS="),
		text.indexOf("export NPMPRO_USER_ENV") + "export NPMPRO_USER_ENV".length,
	);
	const run = (env) => {
		const out = spawnSync("sh", ["-c", `${block}\nprintf '%s|%s' "$NPMPRO_USER_ENV" "$NPMPRO_USER_RUNTIME_ENV"`], {
			env: { PATH: process.env.PATH, ...env },
			encoding: "utf8",
		});
		assert.equal(out.status, 0, out.stderr);
		return out.stdout.split("|");
	};
	assert.deepEqual(run({ ACME_KEY_TYPE: "rsa", TZ: "UTC", PUID: "99", ACME_KEY_SIZE: "" }), [
		"ACME_KEY_TYPE PUID TZ",
		"ACME_KEY_TYPE",
	]);
	assert.deepEqual(run({ ACME_KEY_TYPE: "rsa" }), ["ACME_KEY_TYPE", "ACME_KEY_TYPE"]);
	assert.deepEqual(run({ TZ: "UTC" }), ["TZ", ""]);
	const hashLine = text.split("\n").find((line) => line.startsWith("ENV_SHA512SUM="));
	assert.ok(hashLine.includes('echo "$NPMPRO_USER_RUNTIME_ENV"'));
	assert.equal(hashLine.includes('"$NPMPRO_USER_ENV"'), false);
});

it("keeps userSetEnvNames to the runtime names", () => {
	const env = { NPMPRO_USER_ENV: "ACME_KEY_TYPE HTTP_PORT", ACME_KEY_TYPE: "rsa", HTTP_PORT: "8080" };
	assert.deepEqual([...userSetEnvNames(env)], ["ACME_KEY_TYPE"]);
});
