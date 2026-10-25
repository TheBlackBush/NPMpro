import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { assertProviderForNew, CERTBOT_CONSTRAINTS, certbotEnv, pluginInstallArgs } from "../lib/certbot.js";

const VERSION = /^\d+(?:\.\d+)*(?:(?:a|b|rc|\.post|\.dev)\d+)?$/u;

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
	assert.deepEqual(deprecated.sort(), ["cloudxns", "constellix", "corenetworks", "dnspod", "googledomains", "oci"]);
	for (const key of deprecated) assert.throws(() => assertProviderForNew(key), { status: 400 });
	assert.doesNotThrow(() => assertProviderForNew("cloudflare"));
});

it("routes every certbot call through the minimal environment", () => {
	const source = readFileSync(new URL("../internal/certificate.js", import.meta.url), "utf8");
	assert.equal(source.includes('execFile("certbot"'), false);
	assert.ok(source.includes("runCertbot(["));
});
