import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { CROWDSEC_DEFAULTS, validateCrowdsec } from "../lib/crowdsec/settings.js";
import { tlsContentParses, tlsFileParses, unusableStartFiles } from "../lib/crowdsec/tls-files.js";
import { clientPemFiles, opensslMissing } from "./support/tls-files.js";

// The bouncer parses its TLS client files when nginx starts: the backend applies the same rule as launch.sh
const tlsOn = (extra) => ({
	...CROWDSEC_DEFAULTS,
	enabled: true,
	api_url: "https://lapi:8080",
	use_tls_auth: true,
	tls_client_cert: "/data/crowdsec/client.crt",
	tls_client_key: "/data/crowdsec/client.key",
	...extra,
});

it("lists the TLS client files that keep the bouncer off, only with TLS auth on an enabled bouncer", () => {
	const none = () => false;
	assert.deepEqual(unusableStartFiles(tlsOn(), { parses: () => true }), []);
	assert.deepEqual(unusableStartFiles(tlsOn(), { parses: none }), [
		"/data/crowdsec/client.crt",
		"/data/crowdsec/client.key",
	]);
	assert.deepEqual(
		unusableStartFiles(tlsOn({ tls_client_cert: "" }), { parses: (key) => key === "tls_client_key" }),
		["TLS_CLIENT_CERT"],
	);
	assert.deepEqual(unusableStartFiles(tlsOn({ enabled: false }), { parses: none }), []);
	assert.deepEqual(unusableStartFiles(tlsOn({ use_tls_auth: false }), { parses: none }), []);
	// the pages are not start files: the bouncer runs without them
	assert.deepEqual(
		unusableStartFiles({ ...CROWDSEC_DEFAULTS, enabled: true, captcha_provider: "turnstile" }, { parses: none }),
		[],
	);
});

it("refuses a save with a TLS client file that does not parse", () => {
	const exists = () => true;
	assert.deepEqual(validateCrowdsec(tlsOn(), { exists, parses: () => true }), []);
	assert.deepEqual(validateCrowdsec(tlsOn(), { exists, parses: (key) => key !== "tls_client_key" }), [
		"The TLS client key file /data/crowdsec/client.key is not an unencrypted PEM private key.",
	]);
	assert.deepEqual(validateCrowdsec(tlsOn(), { exists, parses: (key) => key !== "tls_client_cert" }), [
		"The TLS client certificate file /data/crowdsec/client.crt is not a PEM certificate.",
	]);
	// the pages are not parsed, and nothing is checked while the bouncer is off
	assert.deepEqual(validateCrowdsec(tlsOn({ enabled: false }), { exists, parses: () => false }), []);
});

describe("PEM parsing", { skip: opensslMissing && "openssl not available" }, () => {
	let dir;
	let pem;
	before(() => {
		dir = mkdtempSync(path.join(os.tmpdir(), "cs-pem-"));
		pem = clientPemFiles(dir);
	});
	after(() => rmSync(dir, { recursive: true, force: true }));

	it("takes a PEM certificate and an unencrypted PEM key", () => {
		assert.equal(tlsContentParses("tls_client_cert", readFileSync(pem.crt)), true);
		assert.equal(tlsContentParses("tls_client_key", readFileSync(pem.key)), true);
	});

	it("refuses an empty, corrupt, DER, encrypted or swapped file", () => {
		const key = readFileSync(pem.key);
		const crt = readFileSync(pem.crt);
		assert.equal(tlsContentParses("tls_client_cert", Buffer.alloc(0)), false);
		assert.equal(tlsContentParses("tls_client_key", Buffer.alloc(0)), false);
		assert.equal(tlsContentParses("tls_client_key", key.subarray(0, 60)), false);
		assert.equal(tlsContentParses("tls_client_cert", crt.subarray(0, crt.length - 40)), false);
		assert.equal(tlsContentParses("tls_client_cert", readFileSync(pem.der)), false);
		assert.equal(tlsContentParses("tls_client_key", readFileSync(pem.encrypted)), false);
		assert.equal(tlsContentParses("tls_client_cert", key), false);
		assert.equal(tlsContentParses("tls_client_key", crt), false);
	});

	// this test process has no NPMPRO_TEST_ROOT, so rooted() leaves the paths as they are
	it("reads the file, a missing one does not parse", () => {
		assert.equal(tlsFileParses("tls_client_cert", pem.crt), true);
		assert.equal(tlsFileParses("tls_client_key", path.join(dir, "none.key")), false);
		const empty = path.join(dir, "empty.crt");
		writeFileSync(empty, "");
		assert.equal(tlsFileParses("tls_client_cert", empty), false);
	});
});
