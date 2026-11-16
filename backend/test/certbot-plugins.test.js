import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import renovate from "../../renovate.json" with { type: "json" };
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { assertProviderForNew, CERTBOT_CONSTRAINTS, certbotEnv, pluginInstallArgs } from "../lib/certbot.js";

const VERSION = /^\d+(?:\.\d+)*(?:(?:a|b|rc|\.post|\.dev)\d+)?$/u;
const IPP_CREDENTIALS = /^dns_ipp_acme_api_key = /mu;
const BAIDU_ACCESS_KEY = /^dns_baidu_access_key = /mu;
const BAIDU_SECRET_KEY = /^dns_baidu_secret_key = /mu;
const BEGET_DNS_USERNAME = /^dns_beget_plugin_username = /mu;
const BEGET_DNS_PASSWORD = /^dns_beget_plugin_password = /mu;
const BEGET_OLD_USERNAME = /^beget_plugin_username = /mu;
const CERTBOT_VERSION = /^\d+\.\d+\.\d+$/u;

it("pins every DNS plugin to an exact version", () => {
	for (const [key, plugin] of Object.entries(dnsPlugins)) {
		assert.match(plugin.version, VERSION, key);
		assert.ok(plugin.deprecated === undefined || plugin.deprecated === true, key);
	}
});

it("installs a plugin pinned, against the image's certbot constraints, without upgrading", () => {
	const args = pluginInstallArgs({ package_name: "certbot-dns-example", version: "1.2.3" });
	assert.deepEqual(args, [
		"install",
		"--no-cache-dir",
		"--constraint",
		CERTBOT_CONSTRAINTS,
		"certbot-dns-example==1.2.3",
	]);
	assert.equal(args.includes("--upgrade"), false);
});

it("gives certbot and pip only the environment they need", () => {
	const env = certbotEnv({
		PATH: "/usr/bin",
		HOME: "/tmp",
		PIP_USER: "1",
		PYTHONUSERBASE: "/tmp/certbot-python",
		HTTPS_PROXY: "http://proxy:3128",
		DB_MYSQL_PASSWORD: "secret",
		OIDC_CLIENT_SECRET: "secret",
		ACME_EAB_HMAC_KEY: "secret",
		COOKIE_SECRET: "secret",
	});
	assert.deepEqual(env, {
		PATH: "/usr/bin",
		HOME: "/tmp",
		PIP_USER: "1",
		PYTHONUSERBASE: "/tmp/certbot-python",
		HTTPS_PROXY: "http://proxy:3128",
	});
});

it("refuses deprecated providers for new certificates and credentials only", () => {
	const deprecated = Object.keys(dnsPlugins).filter((key) => dnsPlugins[key].deprecated);
	assert.deepEqual(deprecated.sort(), [
		"beget",
		"cloudxns",
		"constellix",
		"corenetworks",
		"dnspod",
		"googledomains",
		"oci",
	]);
	for (const key of deprecated) assert.throws(() => assertProviderForNew(key), { status: 400 });
	assert.doesNotThrow(() => assertProviderForNew("cloudflare"));
});

it("offers ip-projects and the new Baidu and Beget plugins, and keeps the old Beget plugin for what already uses it", () => {
	const entry = (key) => [
		key,
		dnsPlugins[key]?.package_name,
		dnsPlugins[key]?.full_plugin_name,
		dnsPlugins[key]?.deprecated === true,
	];
	assert.deepEqual(["ipp", "baidu", "beget-dns", "beget"].map(entry), [
		["ipp", "certbot-dns-ipp", "dns-ipp", false],
		// the same plugin name and keys as the package it replaces, so saved credentials and renewal files still fit
		["baidu", "certbot-dns-baidu-bcd", "dns-baidu", false],
		["beget-dns", "certbot-dns-beget-plugin", "dns-beget-plugin", false],
		["beget", "certbot-beget-plugin", "beget-plugin", true],
	]);
	assert.match(dnsPlugins.ipp.credentials, IPP_CREDENTIALS);
	assert.match(dnsPlugins.baidu.credentials, BAIDU_ACCESS_KEY);
	assert.match(dnsPlugins.baidu.credentials, BAIDU_SECRET_KEY);
	assert.match(dnsPlugins["beget-dns"].credentials, BEGET_DNS_USERNAME);
	assert.match(dnsPlugins["beget-dns"].credentials, BEGET_DNS_PASSWORD);
	assert.match(dnsPlugins.beget.credentials, BEGET_OLD_USERNAME);
});

// certbot's own DNS plugins are released with certbot and pinned to the same version
const CERTBOT_DNS_PLUGINS = [
	"cloudflare",
	"digitalocean",
	"dnsimple",
	"dnsmadeeasy",
	"google",
	"linode",
	"luadns",
	"nsone",
	"ovh",
	"rfc2136",
];

const pinnedIn = (file, name) =>
	readFileSync(new URL(`../certbot/${file}`, import.meta.url), "utf8").match(
		new RegExp(`^${name}==(\\S+)`, "mu"),
	)?.[1];

it("pins certbot's own DNS plugins and acme at the certbot version of requirements.in", () => {
	const certbot = pinnedIn("requirements.in", "certbot");
	assert.match(certbot, CERTBOT_VERSION);
	assert.equal(pinnedIn("requirements.txt", "certbot"), certbot);
	// acme is pinned in requirements.in too, so the weekly lock refresh cannot move it without certbot
	assert.equal(pinnedIn("requirements.in", "acme"), certbot);
	assert.equal(pinnedIn("requirements.txt", "acme"), certbot);
	for (const key of CERTBOT_DNS_PLUGINS) {
		assert.equal(dnsPlugins[key].version, certbot, key);
	}
});

it("lets Renovate's DNS plugin manager find the pin of every entry in dns-plugins.json", () => {
	const manager = renovate.customManagers.find((entry) =>
		entry.managerFilePatterns.includes("/^backend/certbot/dns-plugins\\.json$/"),
	);
	assert.equal(manager.matchStrings.length, 1);
	// Renovate runs the pattern with RE2-compatible syntax (named groups, no lookaround): keep it simple
	const text = readFileSync(new URL("../certbot/dns-plugins.json", import.meta.url), "utf8");
	const pins = [...text.matchAll(new RegExp(manager.matchStrings[0], "gu"))].map((match) => match.groups.depName);
	// in file order, one per entry
	assert.deepEqual(
		pins,
		Object.values(dnsPlugins).map((plugin) => plugin.package_name),
	);
});
