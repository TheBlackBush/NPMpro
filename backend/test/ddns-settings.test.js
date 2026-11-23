import assert from "node:assert/strict";
import { it } from "node:test";
import { DEFAULT_IPV4_SERVICES, DEFAULT_IPV6_SERVICES } from "../lib/ddns/public-ip.js";
import { ddnsSettingsOf } from "../lib/ddns/settings.js";
import { ddnsTimeMs, RUNTIME_RULES } from "../lib/runtime-rule-table.js";
import { appliesOf, buildEffectiveEnv, mergeRuntimeConfig } from "../lib/runtime-rules.js";

// The ddns runtime group: defaults, env parsing, the range of the times, the service URLs

const ENV = { NPMPRO_USER_ENV: "PATH" };
const userEnv = (vars) => ({ ...ENV, ...vars, NPMPRO_USER_ENV: `PATH ${Object.keys(vars).join(" ")}` });
const rule = (key) => RUNTIME_RULES.find((entry) => entry.group === "ddns" && entry.key === key);
const MINUTE = 60_000;
const FROM_1M = /from 1m to 24h/u;
const SERVER_MAY_NOT_CALL = /an address the server may not call/u;
const NOT_A_DNS_SERVER = /not a DNS server address/u;
const LISTED_TWICE = /listed twice/u;

it("has the defaults of the spec, applied immediately", () => {
	const { values, locked } = mergeRuntimeConfig("ddns", {}, ENV);
	assert.deepEqual(values, {
		period: "5m",
		cooldown: "5m",
		ipv4_services: DEFAULT_IPV4_SERVICES,
		ipv6_services: DEFAULT_IPV6_SERVICES,
		resolver: [],
	});
	assert.deepEqual(locked, []);
	for (const entry of RUNTIME_RULES.filter((one) => one.group === "ddns")) assert.equal(entry.applies, "immediately");
	assert.deepEqual(
		Object.values(appliesOf("ddns")),
		Array.from({ length: 5 }, () => "immediately"),
	);
	assert.ok(DEFAULT_IPV4_SERVICES.every((url) => !url.includes("ipinfo")));
});

it("keeps the default lists apart from the module's own arrays", () => {
	const { values } = mergeRuntimeConfig("ddns", {}, ENV);
	values.ipv4_services.push("https://changed.example");
	assert.equal(DEFAULT_IPV4_SERVICES.length, 3);
});

it("reads the times from 1m to 24h in the nginx syntax, without ms, M and y", () => {
	const good = {
		"1m": MINUTE,
		60: MINUTE,
		"90s": 90_000,
		"5m": 5 * MINUTE,
		"1h30m": 90 * MINUTE,
		"24h": 1440 * MINUTE,
	};
	for (const [text, ms] of Object.entries(good)) assert.equal(ddnsTimeMs(text), ms, text);
	assert.equal(ddnsTimeMs("1d"), 1440 * MINUTE);
	assert.equal(ddnsTimeMs("86400"), 1440 * MINUTE);
	for (const text of [
		"",
		"0",
		"59s",
		"59",
		"86401",
		"1d1s",
		"1w",
		"100ms",
		"1M",
		"1y",
		"1m1h",
		"5 m",
		"5m\n",
		"abc",
		"-1m",
	]) {
		assert.equal(ddnsTimeMs(text), null, JSON.stringify(text));
	}
	assert.equal(ddnsTimeMs(300), null);
	assert.equal(ddnsTimeMs(undefined), null);
	assert.equal(ddnsTimeMs("9".repeat(33)), null);
	for (const key of ["period", "cooldown"]) {
		assert.equal(rule(key).validate("5m"), null);
		assert.match(rule(key).validate("30s"), FROM_1M);
		assert.match(rule(key).validate(300), FROM_1M);
	}
});

it("parses the time envs and ignores a bad one", () => {
	const set = mergeRuntimeConfig("ddns", {}, userEnv({ DDNS_PERIOD: "10m", DDNS_COOLDOWN: "1h" }));
	assert.equal(set.values.period, "10m");
	assert.equal(set.values.cooldown, "1h");
	assert.deepEqual(set.locked, ["period", "cooldown"]);
	assert.deepEqual(set.locked_by, { period: "DDNS_PERIOD", cooldown: "DDNS_COOLDOWN" });
	const bad = mergeRuntimeConfig("ddns", { period: "20m" }, userEnv({ DDNS_PERIOD: "30s" }));
	assert.equal(bad.values.period, "20m");
	assert.deepEqual(bad.invalid, [{ key: "period", source: "env" }]);
	assert.deepEqual(bad.locked, []);
});

it("takes a stored value that is valid and falls back for an invalid one", () => {
	const stored = mergeRuntimeConfig("ddns", { period: "2m", ipv4_services: ["https://a.example"] }, ENV);
	assert.equal(stored.values.period, "2m");
	assert.deepEqual(stored.values.ipv4_services, ["https://a.example"]);
	const broken = mergeRuntimeConfig("ddns", { period: "1s", ipv4_services: ["http://a.example"] }, ENV);
	assert.equal(broken.values.period, "5m");
	assert.deepEqual(broken.values.ipv4_services, DEFAULT_IPV4_SERVICES);
	assert.deepEqual(
		broken.invalid.map((entry) => entry.key),
		["period", "ipv4_services"],
	);
});

it("takes the service lists from the env, one bad word drops the whole value", () => {
	const set = mergeRuntimeConfig(
		"ddns",
		{},
		userEnv({
			DDNS_IPV4_SERVICES: "https://a.example  https://b.example/ip",
			DDNS_IPV6_SERVICES: "https://[2606::1]/",
		}),
	);
	assert.deepEqual(set.values.ipv4_services, ["https://a.example", "https://b.example/ip"]);
	assert.deepEqual(set.values.ipv6_services, ["https://[2606::1]/"]);
	assert.deepEqual(set.locked, ["ipv4_services", "ipv6_services"]);
	const bad = mergeRuntimeConfig("ddns", {}, userEnv({ DDNS_IPV4_SERVICES: "https://a.example http://b.example" }));
	assert.deepEqual(bad.values.ipv4_services, DEFAULT_IPV4_SERVICES);
	assert.deepEqual(bad.locked, []);
	assert.equal(
		rule("ipv4_services").toEnv(["https://a.example", "https://b.example"]),
		"https://a.example https://b.example",
	);
});

it("validates the service lists: https URLs only, 1 to 10", () => {
	const check = rule("ipv4_services");
	assert.equal(
		check.validate(["https://api.ipify.org", "https://[2606:4700::1111]/x", "https://ip.example:8443/a/b"]),
		null,
	);
	for (const bad of [
		["http://a.example"],
		["https://"],
		["https://user@a.example"],
		["https://a.example?x=1"],
		["a.example"],
		["https://a.example/ b"],
		[`https://${"a".repeat(200)}`],
		[5],
		[],
		Array.from({ length: 11 }, (_, index) => `https://h${index}.example`),
		"https://a.example",
		undefined,
	]) {
		assert.notEqual(check.validate(bad), null, JSON.stringify(bad));
	}
	assert.equal(check.validate(Array.from({ length: 10 }, (_, index) => `https://h${index}.example`)), null);
});

it("refuses a service URL with an IP in a blocked range on save only, a name is checked later", () => {
	const check = rule("ipv4_services");
	for (const host of ["127.0.0.1", "169.254.169.254", "0.0.0.0", "[::1]", "[fe80::1]", "224.0.0.1"]) {
		assert.match(check.validateSave([`https://${host}/`]), SERVER_MAY_NOT_CALL, host);
		assert.equal(check.validate([`https://${host}/`]), null, host);
	}
	assert.equal(
		check.validateSave(["https://203.0.113.5/", "https://192.168.1.10/ip", "https://api.ipify.org"]),
		null,
	);
});

it("takes the resolver list like the nginx one: the shape only", () => {
	const check = rule("resolver");
	assert.deepEqual(mergeRuntimeConfig("ddns", {}, ENV).values.resolver, []);
	assert.equal(check.validate(["1.1.1.1", "[::1]:53"]), null);
	assert.match(check.validate(["dns.example"]), NOT_A_DNS_SERVER);
	assert.match(check.validate(["1.1.1.1", "1.1.1.1"]), LISTED_TWICE);
	assert.equal(check.validateSave, undefined);
	const set = mergeRuntimeConfig("ddns", {}, userEnv({ DDNS_RESOLVER: "1.1.1.1 [::1]:53" }));
	assert.deepEqual(set.values.resolver, ["1.1.1.1", "[::1]:53"]);
	assert.deepEqual(set.locked_by, { resolver: "DDNS_RESOLVER" });
	const bad = mergeRuntimeConfig("ddns", {}, userEnv({ DDNS_RESOLVER: "1.1.1.1 dns.example" }));
	assert.deepEqual(bad.values.resolver, []);
	assert.equal(check.toEnv([]), undefined);
	assert.equal(check.toEnv(["1.1.1.1", "[::1]"]), "1.1.1.1 [::1]");
});

it("turns the values into the env form a cycle reads", () => {
	const values = mergeRuntimeConfig("ddns", { period: "10m", resolver: ["1.1.1.1"] }, ENV).values;
	const env = buildEffectiveEnv(ENV, { ddns: { values } });
	assert.equal(env.DDNS_PERIOD, "10m");
	assert.equal(env.DDNS_RESOLVER, "1.1.1.1");
	assert.equal(env.DDNS_IPV4_SERVICES, DEFAULT_IPV4_SERVICES.join(" "));
});

it("reads the settings of a cycle from the env in effect, with the defaults", () => {
	assert.deepEqual(ddnsSettingsOf({}), {
		periodMs: 5 * MINUTE,
		cooldownMs: 5 * MINUTE,
		resolvers: [],
		ipv4Services: DEFAULT_IPV4_SERVICES,
		ipv6Services: DEFAULT_IPV6_SERVICES,
	});
	assert.deepEqual(
		ddnsSettingsOf({
			DDNS_PERIOD: "2m",
			DDNS_COOLDOWN: "1h",
			DDNS_RESOLVER: "9.9.9.9",
			DDNS_IPV4_SERVICES: "https://one.example",
			DDNS_IPV6_SERVICES: "  ",
		}),
		{
			periodMs: 2 * MINUTE,
			cooldownMs: 60 * MINUTE,
			resolvers: ["9.9.9.9"],
			ipv4Services: ["https://one.example"],
			ipv6Services: DEFAULT_IPV6_SERVICES,
		},
	);
	// an env value that cannot be used falls back to the default
	assert.equal(ddnsSettingsOf({ DDNS_PERIOD: "1s" }).periodMs, 5 * MINUTE);
});
