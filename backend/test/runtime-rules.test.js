import assert from "node:assert/strict";
import { it } from "node:test";
import { createRuntimeConfig } from "../lib/runtime-config.js";
import {
	appliesOf,
	buildEffectiveEnv,
	mergeRuntimeConfig,
	RUNTIME_GROUPS,
	RUNTIME_RULES,
	userSetEnvNames,
	userSetNames,
} from "../lib/runtime-rules.js";

const NOPE = /"nope"/u;
const STALE_PROFILE = /certificates\.profile: the stored value was checked against another ACME server/u;
const sorted = (list) => [...list].sort((a, b) => a.localeCompare(b));
const rule = (key) => RUNTIME_RULES.find((entry) => entry.key === key);
const noImages = { fileExists: () => false };
// envs.sh exported defaults, nothing set by the user
const BOOT_ENV = {
	NPMPRO_USER_ENV: "PATH HOME",
	ACME_SERVER: "https://acme-v02.api.letsencrypt.org/directory",
	ACME_KEY_TYPE: "ecdsa",
	ACME_KEY_SIZE: "secp384r1",
	ACME_PROFILE: "shortlived",
	ACME_MUST_STAPLE: "false",
	ACME_OCSP_STAPLING: "false",
	ACME_SERVER_TLS_VERIFY: "true",
	CUSTOM_OCSP_STAPLING: "false",
	CERTBOT_RUN_INTERVAL: "3",
	DEFAULT_CERT_ID: "0",
	ECH_ROTATION_INTERVAL: "1",
	TRUST_CLOUDFLARE: "false",
	LOGROTATE: "false",
	LOGROTATIONS: "3",
	GOA: "false",
	DISABLE_NGINX_BEAUTIFIER: "false",
	DISABLE_GRAVATAR: "false",
	AUTH_REQUEST_ANUBIS_USE_CUSTOM_IMAGES: "false",
};
const userEnv = (vars) => ({ ...BOOT_ENV, ...vars, NPMPRO_USER_ENV: `PATH ${Object.keys(vars).join(" ")}` });

it("has the five groups, every rule in one of them, keys unique", () => {
	assert.deepEqual(RUNTIME_GROUPS, ["certificates", "network", "forward-auth", "logs", "advanced"]);
	for (const entry of RUNTIME_RULES) assert.ok(RUNTIME_GROUPS.includes(entry.group), entry.key);
	assert.equal(new Set(RUNTIME_RULES.map((entry) => entry.key)).size, RUNTIME_RULES.length);
	assert.equal(new Set(RUNTIME_RULES.map((entry) => entry.env)).size, RUNTIME_RULES.length);
	for (const entry of RUNTIME_RULES) {
		assert.ok(["next-certificate", "reload", "immediately"].includes(entry.applies), entry.key);
	}
	assert.equal(appliesOf("logs").log_rotations, "immediately");
	assert.equal(appliesOf("certificates").key_type, "next-certificate");
	assert.equal(appliesOf("network").trusted_ips, "reload");
});

it("validates booleans", () => {
	for (const key of ["must_staple", "server_tls_verify", "ocsp_stapling", "trust_cloudflare", "gravatar"]) {
		assert.equal(rule(key).validate(true), null);
		assert.equal(rule(key).validate(false), null);
		assert.notEqual(rule(key).validate("true"), null);
	}
});

it("validates the key type and the key size per key type", () => {
	assert.equal(rule("key_type").validate("ecdsa"), null);
	assert.equal(rule("key_type").validate("rsa"), null);
	assert.notEqual(rule("key_type").validate("ed25519"), null);
	const size = rule("key_size");
	for (const value of ["secp256r1", "secp384r1", "secp521r1"])
		assert.equal(size.validate(value, { key_type: "ecdsa" }), null);
	for (const value of ["2048", "3072", "4096"]) assert.equal(size.validate(value, { key_type: "rsa" }), null);
	assert.notEqual(size.validate("4096", { key_type: "ecdsa" }), null);
	assert.notEqual(size.validate("secp384r1", { key_type: "rsa" }), null);
	assert.notEqual(size.validate("1024", { key_type: "rsa" }), null);
});

it("validates the integer ranges", () => {
	const cases = { renewal_interval: [1, 499], ech_rotation_interval: [1, 24], log_rotations: [1, 1000] };
	for (const [key, [min, max]] of Object.entries(cases)) {
		assert.equal(rule(key).validate(min), null);
		assert.equal(rule(key).validate(max), null);
		assert.notEqual(rule(key).validate(min - 1), null);
		assert.notEqual(rule(key).validate(max + 1), null);
		assert.notEqual(rule(key).validate(1.5), null);
	}
	assert.equal(rule("default_certificate_id").validate(0), null);
	assert.equal(rule("default_certificate_id").validate(12), null);
	assert.notEqual(rule("default_certificate_id").validate(-1), null);
});

it("validates the ACME profile name", () => {
	assert.equal(rule("profile").validate(""), null);
	assert.equal(rule("profile").validate("shortlived"), null);
	assert.notEqual(rule("profile").validate("short lived"), null);
	assert.equal(rule("profile").parseEnv("none"), "");
	assert.equal(rule("profile").toEnv(""), "none");
});

it("validates forward auth upstreams like envs.sh", () => {
	const upstream = rule("anubis_upstream");
	for (const value of ["", "http://a:1", "https://cu_x", "http://[fd00::1]:8080", "https://auth.example.com:443"]) {
		assert.equal(upstream.validate(value), null, value);
	}
	for (const value of ["http://a/path", "http://a", "ftp://a:1", "http://a:1/", "https://cu_x/y", "a:1"]) {
		assert.notEqual(upstream.validate(value), null, value);
	}
});

it("validates trusted IPs entry by entry", () => {
	const ips = rule("trusted_ips");
	assert.equal(ips.validate([]), null);
	assert.equal(ips.validate(["192.168.1.1", "10.0.0.0/8", "fd00::1", "2001:db8::/32", "::1/128"]), null);
	assert.match(ips.validate(["10.0.0.0/8", "nope"]), NOPE);
	assert.notEqual(ips.validate(["10.0.0.0/33"]), null);
	assert.notEqual(ips.validate(["fd00::/129"]), null);
	assert.notEqual(ips.validate(["300.1.1.1"]), null);
	assert.notEqual(ips.validate(["10.0.0.0/8/1"]), null);
	assert.notEqual(ips.validate("10.0.0.0/8"), null);
	assert.deepEqual(ips.parseEnv(" 10.0.0.0/8  fd00::1 "), ["10.0.0.0/8", "fd00::1"]);
});

it("uses the defaults without stored values and with the envs.sh boot defaults", () => {
	const { values, locked } = mergeRuntimeConfig("certificates", {}, BOOT_ENV);
	assert.deepEqual(locked, []);
	assert.deepEqual(values, {
		key_type: "ecdsa",
		key_size: "secp384r1",
		profile: "shortlived",
		must_staple: false,
		server_tls_verify: true,
		renewal_interval: 3,
		ocsp_stapling: false,
		custom_ocsp_stapling: false,
		default_certificate_id: 0,
		ech_rotation_interval: 1,
	});
	assert.deepEqual(mergeRuntimeConfig("network", {}, BOOT_ENV).values, { trusted_ips: [], trust_cloudflare: false });
	assert.deepEqual(mergeRuntimeConfig("logs", {}, BOOT_ENV).values, { write_log_files: false, log_rotations: 3 });
	assert.deepEqual(mergeRuntimeConfig("advanced", {}, BOOT_ENV).values, { config_beautifier: true, gravatar: true });
	assert.equal(mergeRuntimeConfig("forward-auth", {}, BOOT_ENV, noImages).values.anubis_custom_images, false);
	assert.equal(mergeRuntimeConfig("forward-auth", {}, BOOT_ENV, noImages).values.anubis_upstream, "");
});

it("uses the stored values when nothing is set by the user", () => {
	const { values, locked } = mergeRuntimeConfig("certificates", { key_type: "rsa", key_size: "2048" }, BOOT_ENV);
	assert.deepEqual(locked, []);
	assert.equal(values.key_type, "rsa");
	assert.equal(values.key_size, "2048");
});

it("lets env win and lock the field", () => {
	const env = userEnv({ ACME_KEY_TYPE: "rsa", ACME_KEY_SIZE: "4096", LOGROTATIONS: "7" });
	const certs = mergeRuntimeConfig("certificates", { key_type: "ecdsa", key_size: "secp256r1" }, env);
	assert.equal(certs.values.key_type, "rsa");
	assert.equal(certs.values.key_size, "4096");
	assert.deepEqual(sorted(certs.locked), ["key_size", "key_type"]);
	const logs = mergeRuntimeConfig("logs", { log_rotations: 20 }, env);
	assert.equal(logs.values.log_rotations, 7);
	assert.deepEqual(logs.locked, ["log_rotations"]);
});

it("keeps a set env value that envs.sh accepts even outside the UI range", () => {
	const logs = mergeRuntimeConfig("logs", { log_rotations: 20 }, userEnv({ LOGROTATIONS: "0" }));
	assert.equal(logs.values.log_rotations, 0);
	assert.deepEqual(logs.locked, ["log_rotations"]);
});

it("treats the key size default by key type, and a stored size invalid for an env key type as the default", () => {
	const env = userEnv({ ACME_KEY_TYPE: "rsa" });
	const { values, locked, invalid } = mergeRuntimeConfig("certificates", { key_size: "secp256r1" }, env);
	assert.equal(values.key_size, "4096");
	assert.deepEqual(locked, ["key_type"]);
	assert.deepEqual(invalid, [{ key: "key_size", source: "stored" }]);
	assert.equal(mergeRuntimeConfig("certificates", { key_size: "2048" }, env).values.key_size, "2048");
});

it("derives and locks the key type when only the key size is set", () => {
	const { values, locked } = mergeRuntimeConfig(
		"certificates",
		{ key_type: "rsa" },
		userEnv({ ACME_KEY_SIZE: "secp521r1" }),
	);
	assert.equal(values.key_type, "ecdsa");
	assert.equal(values.key_size, "secp521r1");
	assert.deepEqual(sorted(locked), ["key_size", "key_type"]);
});

it("ignores empty env values", () => {
	const env = { ...userEnv({ TRUST_IP: "" }), AUTH_REQUEST_ANUBIS_UPSTREAM: "" };
	env.NPMPRO_USER_ENV += " AUTH_REQUEST_ANUBIS_UPSTREAM";
	const network = mergeRuntimeConfig("network", { trusted_ips: ["10.0.0.0/8"] }, env);
	assert.deepEqual(network.values.trusted_ips, ["10.0.0.0/8"]);
	assert.deepEqual(network.locked, []);
	const auth = mergeRuntimeConfig("forward-auth", { anubis_upstream: "http://a:1" }, env, noImages);
	assert.equal(auth.values.anubis_upstream, "http://a:1");
	assert.deepEqual(auth.locked, []);
});

it("counts every non-empty runtime env var as set without the envs.sh list", () => {
	assert.deepEqual([...userSetEnvNames({ ACME_KEY_TYPE: "rsa", TRUST_IP: "" })], ["ACME_KEY_TYPE"]);
	assert.deepEqual([...userSetEnvNames(BOOT_ENV)], []);
	assert.deepEqual(mergeRuntimeConfig("logs", { log_rotations: 9 }, { LOGROTATIONS: "3" }).locked, ["log_rotations"]);
});

it("falls back to the default for an invalid stored value", () => {
	const { values, invalid } = mergeRuntimeConfig(
		"certificates",
		{ renewal_interval: 900, key_type: "dsa", profile: "a b" },
		BOOT_ENV,
	);
	assert.equal(values.renewal_interval, 3);
	assert.equal(values.key_type, "ecdsa");
	assert.equal(values.profile, "shortlived");
	assert.deepEqual(
		invalid.map((entry) => entry.key),
		["key_type", "profile", "renewal_interval"],
	);
	assert.deepEqual(mergeRuntimeConfig("network", { trusted_ips: ["bad"] }, BOOT_ENV).values.trusted_ips, []);
});

it("ignores null stored values", () => {
	assert.equal(mergeRuntimeConfig("logs", { log_rotations: null }, BOOT_ENV).values.log_rotations, 3);
});

it("computes the ACME server defaults like envs.sh", () => {
	const google = { ...BOOT_ENV, ACME_SERVER: "https://dv.acme-v02.api.pki.goog/directory" };
	const zerossl = { ...BOOT_ENV, ACME_SERVER: "https://acme.zerossl.com/v2/DV90" };
	const other = { ...BOOT_ENV, ACME_SERVER: "https://ca.example.com/acme/directory" };
	for (const env of [google, zerossl]) {
		const { values } = mergeRuntimeConfig("certificates", {}, env);
		assert.equal(values.must_staple, true);
		assert.equal(values.ocsp_stapling, true);
		assert.equal(values.profile, "");
	}
	const otherValues = mergeRuntimeConfig("certificates", {}, other).values;
	assert.equal(otherValues.must_staple, false);
	assert.equal(otherValues.ocsp_stapling, false);
	assert.equal(otherValues.profile, "");
	assert.equal(mergeRuntimeConfig("certificates", {}, { NPMPRO_USER_ENV: "" }).values.profile, "shortlived");
});

it("forces OCSP stapling on with must-staple and locks it when must-staple is set by env", () => {
	const stored = mergeRuntimeConfig("certificates", { must_staple: true, ocsp_stapling: false }, BOOT_ENV);
	assert.equal(stored.values.ocsp_stapling, true);
	assert.deepEqual(stored.locked, []);
	const env = mergeRuntimeConfig("certificates", { ocsp_stapling: false }, userEnv({ ACME_MUST_STAPLE: "true" }));
	assert.equal(env.values.ocsp_stapling, true);
	assert.deepEqual(sorted(env.locked), ["must_staple", "ocsp_stapling"]);
});

it("locks write_log_files on when GOA is on", () => {
	const { values, locked } = mergeRuntimeConfig("logs", { write_log_files: false }, { ...BOOT_ENV, GOA: "true" });
	assert.equal(values.write_log_files, true);
	assert.deepEqual(locked, ["write_log_files"]);
	const both = mergeRuntimeConfig("logs", {}, { ...userEnv({ LOGROTATE: "false" }), GOA: "true" });
	assert.equal(both.values.write_log_files, true);
	assert.deepEqual(both.locked, ["write_log_files"]);
});

it("parses inverted env vars", () => {
	const { values, locked } = mergeRuntimeConfig(
		"advanced",
		{ config_beautifier: true, gravatar: false },
		userEnv({ DISABLE_NGINX_BEAUTIFIER: "true", DISABLE_GRAVATAR: "false" }),
	);
	assert.deepEqual(values, { config_beautifier: false, gravatar: true });
	assert.deepEqual(locked, ["config_beautifier", "gravatar"]);
});

it("defaults the Anubis custom images to whether all three files exist", () => {
	const seen = [];
	const all = mergeRuntimeConfig("forward-auth", {}, BOOT_ENV, {
		fileExists: (path) => {
			seen.push(path);
			return true;
		},
	});
	assert.equal(all.values.anubis_custom_images, true);
	assert.deepEqual(seen, ["/data/anubis/happy.webp", "/data/anubis/reject.webp", "/data/anubis/pensive.webp"]);
	const some = mergeRuntimeConfig("forward-auth", {}, BOOT_ENV, { fileExists: (path) => path.includes("happy") });
	assert.equal(some.values.anubis_custom_images, false);
});

it("builds the effective env: stored values only for env vars the user did not set", () => {
	const env = userEnv({ ACME_KEY_TYPE: "rsa", TRUST_IP: "10.0.0.1" });
	const configs = {
		certificates: mergeRuntimeConfig("certificates", { key_type: "ecdsa", ocsp_stapling: true, profile: "" }, env),
		network: mergeRuntimeConfig("network", { trusted_ips: ["192.168.0.0/16"], trust_cloudflare: true }, env),
		advanced: mergeRuntimeConfig("advanced", { config_beautifier: false, gravatar: false }, env),
		"forward-auth": mergeRuntimeConfig("forward-auth", { tinyauth_upstream: "http://t:3000" }, env, noImages),
	};
	const out = buildEffectiveEnv({ ...env, AUTH_REQUEST_ANUBIS_UPSTREAM: "stale" }, configs);
	// set by the user: never overridden
	assert.equal(out.ACME_KEY_TYPE, "rsa");
	assert.equal(out.TRUST_IP, "10.0.0.1");
	// not set by the user: the stored value in env form
	assert.equal(out.ACME_OCSP_STAPLING, "true");
	assert.equal(out.ACME_PROFILE, "none");
	assert.equal(out.TRUST_CLOUDFLARE, "true");
	assert.equal(out.DISABLE_NGINX_BEAUTIFIER, "true");
	assert.equal(out.DISABLE_GRAVATAR, "true");
	assert.equal(out.AUTH_REQUEST_TINYAUTH_UPSTREAM, "http://t:3000");
	assert.equal("AUTH_REQUEST_ANUBIS_UPSTREAM" in out, false);
	assert.equal(out.ACME_KEY_SIZE, "4096");
	// groups that are not loaded keep the env, other vars are copied
	assert.equal(out.LOGROTATIONS, "3");
	assert.equal(out.ACME_SERVER, BOOT_ENV.ACME_SERVER);
	assert.notEqual(out, env);
	assert.equal(env.ACME_OCSP_STAPLING, "false");
});

it("keeps today's behaviour with env set and other values stored (review focus 1)", async () => {
	const env = userEnv({ ACME_KEY_TYPE: "rsa", ACME_KEY_SIZE: "2048", DISABLE_GRAVATAR: "true" });
	const stored = {
		certificates: { key_type: "ecdsa", key_size: "secp256r1" },
		advanced: { gravatar: true },
	};
	const config = createRuntimeConfig({ readStored: async (group) => stored[group] ?? {}, env, opts: noImages });
	await config.loadRuntimeConfig();
	const out = config.effectiveEnv();
	assert.equal(out.ACME_KEY_TYPE, "rsa");
	assert.equal(out.ACME_KEY_SIZE, "2048");
	assert.equal(out.DISABLE_GRAVATAR, "true");
	const certs = await config.getRuntimeConfig("certificates");
	assert.deepEqual(sorted(certs.locked), ["key_size", "key_type"]);
	assert.equal(certs.values.key_type, "rsa");
});

it("caches per group, invalidates, logs an invalid stored value once and takes overrides", async () => {
	let reads = 0;
	let stored = { log_rotations: 5000 };
	const warnings = [];
	const config = createRuntimeConfig({
		readStored: () => {
			reads += 1;
			return Promise.resolve(stored);
		},
		env: BOOT_ENV,
		log: { warn: (message) => warnings.push(message) },
		opts: noImages,
	});
	assert.equal(config.effectiveEnv().LOGROTATIONS, "3");
	assert.equal((await config.getRuntimeConfig("logs")).values.log_rotations, 3);
	await config.getRuntimeConfig("logs");
	assert.equal(reads, 1);
	config.invalidate("logs");
	await config.getRuntimeConfig("logs");
	assert.equal(reads, 2);
	assert.equal(warnings.length, 1);
	stored = { log_rotations: 12 };
	config.invalidate("logs");
	await config.getRuntimeConfig("logs");
	assert.equal(config.effectiveEnv().LOGROTATIONS, "12");
	assert.equal(config.effectiveEnv({ logs: { write_log_files: true, log_rotations: 40 } }).LOGROTATIONS, "40");
	assert.equal(config.effectiveEnv().LOGROTATIONS, "12");
	const cached = await config.getRuntimeConfig("logs");
	cached.values.log_rotations = 99;
	assert.equal((await config.getRuntimeConfig("logs")).values.log_rotations, 12);
});

it("never overrides an env var the user set, whatever the configs hold", () => {
	const env = userEnv({ ACME_KEY_TYPE: "rsa", TRUST_IP: " 10.0.0.1   10.0.0.2", LOGROTATIONS: "007" });
	const out = buildEffectiveEnv(env, {
		certificates: { values: { ...mergeRuntimeConfig("certificates", {}, BOOT_ENV).values, key_type: "ecdsa" } },
		network: { values: { trusted_ips: [], trust_cloudflare: false } },
		logs: { values: { write_log_files: false, log_rotations: 3 } },
	});
	assert.equal(out.ACME_KEY_TYPE, "rsa");
	assert.equal(out.TRUST_IP, " 10.0.0.1   10.0.0.2");
	assert.equal(out.LOGROTATIONS, "007");
	assert.equal(out.ACME_KEY_SIZE, "secp384r1");
});

it("locks must-staple off when OCSP stapling is switched off by env", () => {
	const env = userEnv({ ACME_OCSP_STAPLING: "false" });
	const merged = mergeRuntimeConfig("certificates", { must_staple: true }, env);
	assert.equal(merged.values.must_staple, false);
	assert.equal(merged.values.ocsp_stapling, false);
	assert.deepEqual(sorted(merged.locked), ["must_staple", "ocsp_stapling"]);
	const out = buildEffectiveEnv(env, { certificates: merged });
	assert.equal(out.ACME_MUST_STAPLE, String(merged.values.must_staple));
	assert.equal(out.ACME_OCSP_STAPLING, String(merged.values.ocsp_stapling));
	// OCSP stapling on by env leaves must-staple editable
	const on = mergeRuntimeConfig("certificates", { must_staple: true }, userEnv({ ACME_OCSP_STAPLING: "true" }));
	assert.equal(on.values.must_staple, true);
	assert.deepEqual(on.locked, ["ocsp_stapling"]);
});

it("does not count a whitespace-only env value as set", () => {
	const env = { ...userEnv({ TRUST_IP: "   " }) };
	assert.equal(userSetEnvNames(env).has("TRUST_IP"), false);
	const network = mergeRuntimeConfig("network", { trusted_ips: ["10.0.0.0/8"] }, env);
	assert.deepEqual(network.values.trusted_ips, ["10.0.0.0/8"]);
	assert.deepEqual(network.locked, []);
	assert.equal(buildEffectiveEnv(env, { network }).TRUST_IP, "10.0.0.0/8");
});

it("returns the set names of any list with userSetNames", () => {
	const env = { NPMPRO_USER_ENV: "A B", A: "1", B: "", C: "3" };
	assert.deepEqual([...userSetNames(env, ["A", "B", "C"])], ["A"]);
	assert.deepEqual([...userSetNames({ A: "1", C: " " }, ["A", "C"])], ["A"]);
});

it("does not cache a read that a save overtook", async () => {
	let stored = { log_rotations: 4 };
	let release;
	let slow = true;
	const config = createRuntimeConfig({
		readStored: () => {
			const snapshot = stored;
			if (!slow) return Promise.resolve(snapshot);
			return new Promise((resolve) => {
				release = () => resolve(snapshot);
			});
		},
		env: BOOT_ENV,
		opts: noImages,
	});
	const pending = config.getRuntimeConfig("logs");
	// the save: new row, then the cache refresh
	stored = { log_rotations: 8 };
	config.invalidate("logs");
	slow = false;
	release();
	assert.equal((await pending).values.log_rotations, 4);
	assert.equal((await config.getRuntimeConfig("logs")).values.log_rotations, 8);
	assert.equal(config.effectiveEnv().LOGROTATIONS, "8");
});

it("ignores a stored profile checked against another ACME server (Let's Encrypt to ZeroSSL)", () => {
	const le = "https://acme-v02.api.letsencrypt.org/directory";
	const zerossl = "https://acme.zerossl.com/v2/DV90";
	const stored = { profile: "classic", profile_server: le };
	const onLe = mergeRuntimeConfig("certificates", stored, BOOT_ENV, noImages);
	assert.equal(onLe.values.profile, "classic");
	assert.deepEqual(onLe.invalid, []);
	assert.equal("profile_server" in onLe.values, false);

	const onZerossl = mergeRuntimeConfig("certificates", stored, { ...BOOT_ENV, ACME_SERVER: zerossl }, noImages);
	assert.equal(onZerossl.values.profile, "");
	assert.deepEqual(onZerossl.invalid, [{ key: "profile", source: "server" }]);

	const unchecked = mergeRuntimeConfig("certificates", { profile: "classic" }, BOOT_ENV, noImages);
	assert.equal(unchecked.values.profile, "shortlived");
	const none = mergeRuntimeConfig("certificates", { profile: "" }, { ...BOOT_ENV, ACME_SERVER: zerossl }, noImages);
	assert.equal(none.values.profile, "");
	assert.deepEqual(none.invalid, []);
});

it("logs a stale stored profile once through the accessor", async () => {
	const warnings = [];
	const config = createRuntimeConfig({
		env: { ...BOOT_ENV, ACME_SERVER: "https://acme.zerossl.com/v2/DV90" },
		readStored: () =>
			Promise.resolve({ profile: "classic", profile_server: "https://acme-v02.api.letsencrypt.org/directory" }),
		log: { warn: (line) => warnings.push(line) },
		opts: noImages,
	});
	await config.getRuntimeConfig("certificates");
	config.invalidate();
	await config.getRuntimeConfig("certificates");
	assert.equal(warnings.length, 1);
	assert.match(warnings[0], STALE_PROFILE);
});
