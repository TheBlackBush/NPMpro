import assert from "node:assert/strict";
import { it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import Ajv from "ajv/dist/2020.js";
import { runtimeExclusive, runtimeQueue } from "../internal/runtime-queue.js";
import { createRuntimeUpdater, runtimeView } from "../internal/runtime-update.js";
import { createRuntimeConfig } from "../lib/runtime-config.js";
import { mergeRuntimeConfig, RUNTIME_GROUPS } from "../lib/runtime-rules.js";
import { DEDICATED_IDS, HIDDEN_IDS, isDedicatedSettingId } from "../lib/setting-ids.js";
import { getCompiledSchema } from "../schema/index.js";

const BOOT_ENV = { NPMPRO_USER_ENV: "PATH", ACME_SERVER: "https://acme-v02.api.letsencrypt.org/directory" };
const BAD_IP = /^trusted_ips: "bad"/u;
const BAD_UPSTREAM = /^anubis_upstream: /u;
const BAD_SIZE = /^key_size: must be 2048, 3072, 4096 for rsa/u;
const sortedKeys = (object) => Object.keys(object).sort((a, b) => a.localeCompare(b));
const noImages = { fileExists: () => false };

const fakeStore = (initial = {}) => {
	const rows = structuredClone(initial);
	return {
		rows,
		readStored: async (group) => {
			await sleep(5);
			return structuredClone(rows[group] ?? {});
		},
		saveStored: async (group, meta) => {
			await sleep(5);
			rows[group] = structuredClone(meta);
		},
	};
};

const updater = (store, { apply = async () => {}, env = BOOT_ENV, ...rest } = {}) =>
	createRuntimeUpdater({ ...store, getApply: () => apply, env, opts: noImages, ...rest });

it("saves the editable keys and returns the merged values", async () => {
	const store = fakeStore();
	const update = updater(store);
	const out = await update("logs", { log_rotations: 10 });
	assert.deepEqual(store.rows.logs, { log_rotations: 10 });
	assert.deepEqual(out.values, {
		write_log_files: false,
		log_rotations: 10,
		goaccess: false,
		goaccess_keep_days: 30,
		goaccess_anonymize: "1",
		goaccess_drop_query_strings: true,
		goaccess_real_os: true,
		goaccess_resolve_hosts: true,
	});
});

it("drops locked keys", async () => {
	const store = fakeStore({ certificates: { renewal_interval: 5 } });
	const env = { ...BOOT_ENV, ACME_KEY_TYPE: "rsa", NPMPRO_USER_ENV: "ACME_KEY_TYPE" };
	const calls = [];
	const update = updater(store, { env, apply: async (...args) => calls.push(args) });
	await update("certificates", { key_type: "ecdsa", renewal_interval: 8 });
	assert.deepEqual(store.rows.certificates, { renewal_interval: 8 });
	assert.equal(calls[0][1].key_type, "rsa");
	// only locked keys: nothing applied or saved
	const before = calls.length;
	await update("certificates", { key_type: "ecdsa" });
	assert.equal(calls.length, before);
	assert.deepEqual(store.rows.certificates, { renewal_interval: 8 });
});

it("drops GOA locked write_log_files", async () => {
	const store = fakeStore();
	const update = updater(store, { env: { ...BOOT_ENV, GOA: "true" } });
	const out = await update("logs", { write_log_files: false, log_rotations: 4 });
	assert.deepEqual(store.rows.logs, { log_rotations: 4 });
	assert.equal(out.values.write_log_files, true);
});

it("calls apply with the next and previous values before the save", async () => {
	const store = fakeStore({ network: { trust_cloudflare: false } });
	const seen = [];
	const update = updater(store, {
		apply: (group, next, prev) => {
			seen.push({ group, next, prev, storedAtApply: structuredClone(store.rows.network) });
			return Promise.resolve();
		},
	});
	await update("network", { trusted_ips: ["10.0.0.0/8"], trust_cloudflare: true });
	assert.equal(seen.length, 1);
	assert.equal(seen[0].group, "network");
	assert.deepEqual(seen[0].next, { trusted_ips: ["10.0.0.0/8"], trust_cloudflare: true });
	assert.deepEqual(seen[0].prev, { trusted_ips: [], trust_cloudflare: false });
	assert.deepEqual(seen[0].storedAtApply, { trust_cloudflare: false });
	assert.deepEqual(store.rows.network, { trusted_ips: ["10.0.0.0/8"], trust_cloudflare: true });
});

it("stores nothing and rethrows when apply throws, then keeps working", async () => {
	const store = fakeStore({ logs: { log_rotations: 3 } });
	const failure = new Error("nginx: [emerg] bad");
	let fail = true;
	const saved = [];
	const update = updater(store, {
		apply: () => (fail ? Promise.reject(failure) : Promise.resolve()),
		onSaved: (group) => saved.push(group),
	});
	await assert.rejects(update("logs", { log_rotations: 9 }), (err) => err === failure);
	assert.deepEqual(store.rows.logs, { log_rotations: 3 });
	assert.deepEqual(saved, []);
	fail = false;
	await update("logs", { log_rotations: 9 });
	assert.deepEqual(store.rows.logs, { log_rotations: 9 });
	assert.deepEqual(saved, ["logs"]);
});

it("serializes concurrent updates across groups", async () => {
	const store = fakeStore();
	const order = [];
	const update = updater(store, {
		apply: async (group) => {
			order.push(`start ${group}`);
			await sleep(group === "logs" ? 30 : 1);
			order.push(`end ${group}`);
		},
	});
	await Promise.all([
		update("logs", { log_rotations: 5 }),
		update("advanced", { gravatar: false }),
		update("logs", { write_log_files: true }),
	]);
	assert.deepEqual(order, ["start logs", "end logs", "start advanced", "end advanced", "start logs", "end logs"]);
	assert.deepEqual(store.rows.logs, { log_rotations: 5, write_log_files: true });
	assert.deepEqual(store.rows.advanced, { gravatar: false });
});

it("refuses invalid values with the field name and saves nothing", async () => {
	const store = fakeStore();
	let applied = 0;
	const update = updater(store, {
		apply: () => {
			applied += 1;
			return Promise.resolve();
		},
	});
	await assert.rejects(update("network", { trusted_ips: ["10.0.0.0/8", "bad"] }), {
		name: "ValidationError",
		message: BAD_IP,
	});
	await assert.rejects(update("forward-auth", { anubis_upstream: "http://a/path" }), {
		name: "ValidationError",
		message: BAD_UPSTREAM,
	});
	await assert.rejects(update("certificates", { key_type: "rsa", key_size: "secp384r1" }), {
		name: "ValidationError",
		message: BAD_SIZE,
	});
	assert.equal(applied, 0);
	assert.deepEqual(store.rows, {});
});

it("checks the key size against the new key type and drops a stored size the change made invalid", async () => {
	const store = fakeStore({ certificates: { key_size: "secp256r1" } });
	const update = updater(store);
	await update("certificates", { key_type: "rsa", key_size: "3072" });
	assert.deepEqual(store.rows.certificates, { key_type: "rsa", key_size: "3072" });
	const store2 = fakeStore({ certificates: { key_size: "secp256r1" } });
	const out = await updater(store2)("certificates", { key_type: "rsa" });
	assert.deepEqual(store2.rows.certificates, { key_type: "rsa" });
	assert.equal(out.values.key_size, "4096");
});

it("refuses a default certificate that does not exist", async () => {
	const store = fakeStore();
	const update = updater(store, {
		findCertificate: async (id) => ({ 4: { id, provider: "other" }, 8: { id, provider: "mtls" } })[id],
	});
	await assert.rejects(update("certificates", { default_certificate_id: 7 }), {
		name: "ValidationError",
		message: "default_certificate_id: Certificate not found",
	});
	await assert.rejects(update("certificates", { default_certificate_id: 8 }), {
		name: "ValidationError",
		message: "default_certificate_id: an mTLS CA certificate cannot be the default certificate",
	});
	await update("certificates", { default_certificate_id: 4 });
	await update("certificates", { default_certificate_id: 0 });
	assert.deepEqual(store.rows.certificates, { default_certificate_id: 0 });
});

it("runs an exclusive check in the save queue, not between a save's apply and store", async () => {
	const store = fakeStore();
	const order = [];
	const update = updater(store, {
		apply: async () => {
			order.push("apply");
			await sleep(20);
		},
	});
	const saving = update("certificates", { default_certificate_id: 4 });
	const check = update.exclusive(() => {
		order.push(`check ${store.rows.certificates?.default_certificate_id}`);
		return Promise.resolve();
	});
	await Promise.all([saving, check]);
	assert.deepEqual(order, ["apply", "check 4"]);
});

it("primes the runtime config with the saved values, effectiveEnv has them before any read", async () => {
	const store = fakeStore();
	const env = { ...BOOT_ENV, NPMPRO_USER_ENV: "" };
	let configReads = 0;
	const config = createRuntimeConfig({
		env,
		readStored: (group) => {
			configReads++;
			return store.readStored(group);
		},
	});
	await config.loadRuntimeConfig();
	assert.equal(config.effectiveEnv().ACME_OCSP_STAPLING, "false");
	configReads = 0;
	const update = updater(store, { env, onSaved: (group, cfg) => config.prime(group, cfg) });
	// what updateRuntime does: the audit insert after the save may throw, the cache is already primed
	const audited = update("certificates", { ocsp_stapling: true }).then(() => {
		throw new Error("audit insert failed");
	});
	await assert.rejects(audited, { message: "audit insert failed" });
	assert.equal(configReads, 0);
	assert.equal(config.effectiveEnv().ACME_OCSP_STAPLING, "true");
	assert.equal((await config.getRuntimeConfig("certificates")).values.ocsp_stapling, true);
	assert.equal(configReads, 0);
});

it("answers 404 for an unknown group", async () => {
	await assert.rejects(updater(fakeStore())("monitoring", { retention_days: 1 }), { name: "ItemNotFoundError" });
});

it("refuses the runtime ids in the generic settings route and hides them", () => {
	for (const id of [...RUNTIME_GROUPS, "oidc", "monitoring", "geoip", " Certificates "]) {
		assert.equal(isDedicatedSettingId(id), true, id);
	}
	assert.equal(isDedicatedSettingId("default-site"), false);
	for (const group of RUNTIME_GROUPS) {
		assert.ok(DEDICATED_IDS.includes(group));
		assert.ok(HIDDEN_IDS.includes(group));
	}
});

it("matches the OpenAPI schemas: GET view, PUT body", async () => {
	const schema = await getCompiledSchema();
	const ajv = new Ajv({ strict: false, allowUnionTypes: true });
	for (const group of RUNTIME_GROUPS) {
		const path = schema.paths[`/settings/runtime/${group}`];
		assert.ok(path?.get && path?.put, group);
		const view = runtimeView(group, mergeRuntimeConfig(group, {}, BOOT_ENV, noImages), BOOT_ENV);
		const response = path.get.responses["200"].content["application/json"].schema;
		assert.equal(ajv.validate(response, view), true, `${group}: ${ajv.errorsText()}`);
		const {
			locked: _locked,
			locked_by: _lockedBy,
			locked_reason: _lockedReason,
			applies: _applies,
			restart_pending: _restartPending,
			...values
		} = view;
		const body = path.put.requestBody.content["application/json"].schema;
		assert.equal(ajv.validate(body, values), true, `${group}: ${ajv.errorsText()}`);
		assert.equal(ajv.validate(body, {}), false, `${group} accepts an empty body`);
		assert.equal(ajv.validate(body, { locked: [] }), false, `${group} accepts unknown keys`);
		assert.deepEqual(sortedKeys(body.properties), sortedKeys(values));
	}
	// a view with locks: locked_by names the variables
	const lockedEnv = { ...BOOT_ENV, ACME_KEY_SIZE: "4096", NPMPRO_USER_ENV: "ACME_KEY_SIZE" };
	const lockedView = runtimeView("certificates", mergeRuntimeConfig("certificates", {}, lockedEnv, noImages));
	assert.deepEqual(lockedView.locked_by, { key_size: "ACME_KEY_SIZE", key_type: "ACME_KEY_SIZE" });
	// key_type is locked by the key size variable (indirect), key_size by its own one
	assert.deepEqual(lockedView.locked_reason, { key_type: "key-size" });
	const certificates =
		schema.paths["/settings/runtime/certificates"].get.responses["200"].content["application/json"];
	assert.equal(ajv.validate(certificates.schema, lockedView), true, ajv.errorsText());
	assert.equal(ajv.validate(certificates.schema, { ...lockedView, locked_by: { nope: "X" } }), false);
	assert.equal(ajv.validate(certificates.schema, { ...lockedView, locked_reason: { key_type: "goaccess" } }), false);
	const logs = schema.paths["/settings/runtime/logs"].get.responses["200"].content["application/json"].schema;
	const goaEnv = { ...BOOT_ENV, GOA: "true" };
	const goaView = runtimeView("logs", mergeRuntimeConfig("logs", {}, goaEnv, noImages), goaEnv);
	// running with GOA=true from the startup settings file: locked by the GoAccess report setting, not by env
	assert.deepEqual(goaView.locked_reason, { write_log_files: "goaccess-setting" });
	// stored off: a restart turns it off
	assert.deepEqual(goaView.restart_pending, ["goaccess"]);
	assert.equal(ajv.validate(logs, goaView), true, ajv.errorsText());
	const advanced = schema.paths["/settings/runtime/advanced"].get.responses["200"].content["application/json"].schema;
	const tzView = {
		...runtimeView("advanced", mergeRuntimeConfig("advanced", { time_zone: "UTC" }, BOOT_ENV), BOOT_ENV),
		time_zones: ["UTC"],
	};
	assert.equal(ajv.validate(advanced, tzView), true, ajv.errorsText());
	assert.equal(ajv.validate(advanced, { ...tzView, restart_pending: ["gravatar"] }), false);
	const network = schema.paths["/settings/runtime/network"].get.responses["200"].content["application/json"].schema;
	const networkView = runtimeView("network", mergeRuntimeConfig("network", {}, BOOT_ENV), BOOT_ENV);
	assert.equal(ajv.validate(network, { ...networkView, restart_pending: ["trusted_ips"] }), false);
});

it("drops must_staple when OCSP stapling is switched off by env", async () => {
	const store = fakeStore();
	const env = { ...BOOT_ENV, ACME_OCSP_STAPLING: "false", NPMPRO_USER_ENV: "ACME_OCSP_STAPLING" };
	const out = await updater(store, { env })("certificates", { must_staple: true, renewal_interval: 6 });
	assert.deepEqual(store.rows.certificates, { renewal_interval: 6 });
	assert.equal(out.values.must_staple, false);
	assert.ok(out.locked.includes("must_staple"));
});

it("stores the ACME server a profile was checked against, never in the view", async () => {
	const store = fakeStore();
	const update = updater(store);
	const result = await update("certificates", { profile: "classic" });
	assert.deepEqual(store.rows.certificates, { profile: "classic", profile_server: BOOT_ENV.ACME_SERVER });
	assert.equal("profile_server" in runtimeView("certificates", result), false);
	await update("certificates", { profile: "" });
	assert.deepEqual(store.rows.certificates, { profile: "" });
});

it("passes the merged previous values (env-locked keys included) to apply inside the queue", async () => {
	const store = fakeStore({ certificates: { renewal_interval: 5 } });
	const env = { ...BOOT_ENV, ACME_KEY_SIZE: "secp521r1", NPMPRO_USER_ENV: "ACME_KEY_SIZE" };
	const seen = [];
	let running = 0;
	const update = updater(store, {
		env,
		apply: async (_group, next, prev) => {
			running += 1;
			seen.push({ next, prev, overlap: running > 1 });
			await sleep(10);
			running -= 1;
		},
	});
	await Promise.all([
		update("certificates", { renewal_interval: 6 }),
		update("certificates", { renewal_interval: 7 }),
	]);
	assert.deepEqual(seen[0].prev, mergeRuntimeConfig("certificates", { renewal_interval: 5 }, env, noImages).values);
	assert.equal(seen[0].prev.key_size, "secp521r1");
	assert.equal(seen[0].prev.key_type, "ecdsa");
	assert.equal(seen[1].prev.renewal_interval, 6);
	assert.deepEqual(
		seen.map((entry) => entry.overlap),
		[false, false],
	);
});

it("a host config write during a runtime save waits for it and renders with the values the save left", async () => {
	for (const saveFails of [false, true]) {
		const env = BOOT_ENV;
		const store = fakeStore();
		const config = createRuntimeConfig({ env, readStored: store.readStored });
		await config.loadRuntimeConfig();
		const order = [];
		// the host config file: the save renders it (stapling), the host edit (configure) renders it too
		let hostConf = "initial";
		let releaseApply;
		let applyStarted;
		const started = new Promise((resolve) => {
			applyStarted = resolve;
		});
		const apply = async (_group, next, _prev, options) => {
			order.push(options?.revert ? "revert" : "apply");
			hostConf = `save stapling ${next.ocsp_stapling}`;
			if (options?.revert) return;
			applyStarted();
			await new Promise((resolve) => {
				releaseApply = resolve;
			});
		};
		const update = updater(
			{
				...store,
				saveStored: saveFails ? () => Promise.reject(new Error("db down")) : store.saveStored,
			},
			{ apply, env, serialize: runtimeQueue, onSaved: (group, cfg) => config.prime(group, cfg) },
		);
		const saved = update("certificates", { ocsp_stapling: true }).catch((err) => err);
		await started;
		// what internalNginx.configure does: runs in the queue, renders with effectiveEnv()
		const edited = runtimeExclusive(() => {
			order.push("configure");
			hostConf = `host edit stapling ${config.effectiveEnv().ACME_OCSP_STAPLING}`;
		});
		await sleep(10);
		assert.deepEqual(order, ["apply"]);
		releaseApply();
		const result = await saved;
		await edited;
		assert.deepEqual(order, saveFails ? ["apply", "revert", "configure"] : ["apply", "configure"]);
		assert.equal(result instanceof Error ? result.message : "saved", saveFails ? "db down" : "saved");
		// the host edit is the last write and follows the values in effect after the save
		assert.equal(hostConf, `host edit stapling ${saveFails ? "false" : "true"}`);
	}
});
