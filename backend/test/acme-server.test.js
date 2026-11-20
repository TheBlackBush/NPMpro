import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import {
	acmeEnvSet,
	GOOGLE_SERVER,
	isDirectoryUrl,
	isTrustedServer,
	isZeroSsl,
	LETSENCRYPT_SERVER,
	normalizeServer,
	presetOf,
	requestOptionsFor,
	resolveAcmeServer,
	sameServer,
	serverKey,
	setStoredAcmeServer,
	storedAcmeServer,
	ZEROSSL_SERVER,
} from "../lib/acme-server.js";
import { mergeRuntimeConfig } from "../lib/runtime-rules.js";

const PEBBLE = "https://npmpro-test-pebble:14000/dir";
afterEach(() => setStoredAcmeServer(undefined));

it("accepts only https directory URLs of the startup-settings charset, at most 255 characters", () => {
	for (const url of [
		LETSENCRYPT_SERVER,
		ZEROSSL_SERVER,
		PEBBLE,
		"https://ca.lan/acme/acme/directory",
		"https://10.0.0.5/dir",
	]) {
		assert.equal(isDirectoryUrl(url), true, url);
	}
	for (const url of [
		"http://ca.lan/dir",
		"https://",
		"https:///dir",
		"https://ca.lan/dir?x=1",
		"https://ca.lan/a b",
		"https://ca.lan/$(id)",
		"https://user@ca.lan/dir",
		`https://ca.lan/${"a".repeat(250)}`,
		"",
		null,
	]) {
		assert.equal(isDirectoryUrl(url), false, String(url));
	}
});

it("lists the ACME variables the user set: NPMPRO_USER_ENV when envs.sh ran, else every non-empty one", () => {
	const env = { ACME_SERVER: PEBBLE, ACME_EMAIL: "a@b.c", ACME_EAB_KID: " ", NPMPRO_USER_ENV: "PATH ACME_EMAIL" };
	assert.deepEqual([...acmeEnvSet(env)], ["ACME_EMAIL"]);
	const { NPMPRO_USER_ENV: _, ...noList } = env;
	assert.deepEqual([...acmeEnvSet(noList)], ["ACME_SERVER", "ACME_EMAIL"]);
});

it("resolves the instance CA: a user-set env, else the stored value, else the start mirror, else Let's Encrypt", () => {
	const userSet = { ACME_SERVER: PEBBLE, NPMPRO_USER_ENV: "ACME_SERVER" };
	const mirrored = { ACME_SERVER: ZEROSSL_SERVER, NPMPRO_USER_ENV: "PATH" };
	assert.equal(resolveAcmeServer(userSet, GOOGLE_SERVER), PEBBLE);
	assert.equal(resolveAcmeServer(mirrored, GOOGLE_SERVER), GOOGLE_SERVER);
	assert.equal(resolveAcmeServer(mirrored, null), LETSENCRYPT_SERVER);
	assert.equal(resolveAcmeServer(mirrored, undefined), ZEROSSL_SERVER);
	assert.equal(resolveAcmeServer({ NPMPRO_USER_ENV: "" }, undefined), LETSENCRYPT_SERVER);
	assert.equal(resolveAcmeServer({ ACME_SERVER: "not a url", NPMPRO_USER_ENV: "" }, undefined), LETSENCRYPT_SERVER);
});

it("keeps the stored value: undefined until loaded, null for Let's Encrypt or an unusable value", () => {
	assert.equal(storedAcmeServer(), undefined);
	setStoredAcmeServer(PEBBLE);
	assert.equal(storedAcmeServer(), PEBBLE);
	assert.equal(resolveAcmeServer({ NPMPRO_USER_ENV: "" }), PEBBLE);
	for (const value of [null, LETSENCRYPT_SERVER, "http://x/dir", 7]) {
		setStoredAcmeServer(value);
		assert.equal(storedAcmeServer(), null, String(value));
	}
});

it("trusts only the user-set env URL and names ZeroSSL and the presets", () => {
	const env = { ACME_SERVER: "https://127.0.0.1:14000/dir", NPMPRO_USER_ENV: "ACME_SERVER" };
	assert.equal(isTrustedServer("https://127.0.0.1:14000/dir", env), true);
	assert.equal(isTrustedServer(PEBBLE, env), false);
	assert.equal(
		isTrustedServer("https://127.0.0.1:14000/dir", { ...env, ACME_SERVER: "https://LOCAL.lan/dir" }),
		false,
	);
	assert.equal(isTrustedServer("https://local.lan/dir", { ...env, ACME_SERVER: "https://LOCAL.lan/dir" }), true);
	assert.equal(isTrustedServer("https://127.0.0.1:14000/dir", { ...env, NPMPRO_USER_ENV: "" }), false);
	assert.equal(isZeroSsl(ZEROSSL_SERVER), true);
	assert.equal(isZeroSsl("https://acme.zerossl.com/v2/other"), true);
	assert.equal(isZeroSsl(LETSENCRYPT_SERVER), false);
	assert.equal(presetOf(GOOGLE_SERVER), "google");
	assert.equal(presetOf(PEBBLE), null);
});

it("gives a request the instance options on the instance CA, else that CA's defaults", () => {
	const values = { profile: "tlsserver", must_staple: true };
	assert.deepEqual(requestOptionsFor(PEBBLE, PEBBLE, values), { profile: "tlsserver", must_staple: true });
	assert.deepEqual(requestOptionsFor(LETSENCRYPT_SERVER, PEBBLE, values), { profile: "", must_staple: false });
	assert.deepEqual(requestOptionsFor(ZEROSSL_SERVER, PEBBLE, values), { profile: "", must_staple: true });
	assert.deepEqual(requestOptionsFor(GOOGLE_SERVER, PEBBLE, values), { profile: "", must_staple: true });
});

it("lets the runtime defaults follow the stored CA (D8)", () => {
	const env = { NPMPRO_USER_ENV: "PATH" };
	setStoredAcmeServer(ZEROSSL_SERVER);
	let { values } = mergeRuntimeConfig("certificates", {}, env);
	assert.equal(values.must_staple, true);
	assert.equal(values.ocsp_stapling, true);
	assert.equal(values.profile, "");
	setStoredAcmeServer(null);
	({ values } = mergeRuntimeConfig("certificates", {}, env));
	assert.equal(values.must_staple, false);
	assert.equal(values.profile, "shortlived");
});

it("gives the spellings of one CA URL one key", () => {
	assert.equal(serverKey("HTTPS://Acme.Test/directory/"), "https://acme.test/directory");
	assert.equal(serverKey("https://acme.test:443/directory"), "https://acme.test/directory");
	assert.notEqual(serverKey("https://acme.test/a"), serverKey("https://acme.test/b"));
	assert.equal(serverKey("not a url"), "not a url");
	assert.equal(serverKey("https://acme-v01.api.letsencrypt.org/directory/"), LETSENCRYPT_SERVER);
	assert.equal(
		serverKey("https://acme-staging.api.letsencrypt.org/directory"),
		"https://acme-staging-v02.api.letsencrypt.org/directory",
	);
	assert.ok(sameServer(`${LETSENCRYPT_SERVER}/`, "https://acme-v01.api.letsencrypt.org/directory"));
	assert.ok(!sameServer("https://acme.test/a", "https://acme.test/b"));
});

it("lowers the scheme and host of a typed URL and keeps its path, port and query", () => {
	assert.equal(normalizeServer(" HTTPS://CA.Example.COM:14000/Dir/X "), "https://ca.example.com:14000/Dir/X");
	assert.equal(normalizeServer("https://CA.lan"), "https://ca.lan");
	assert.equal(normalizeServer("https://CA.lan?Q=A"), "https://ca.lan?Q=A");
	assert.equal(normalizeServer(undefined), undefined);
});
