import assert from "node:assert/strict";
import { it } from "node:test";
import { cleanCertbotMessage, GENERIC, MAX_CLEAN, REQUEST_MAX } from "../lib/certbot-message.js";

const WARNING = [
	"/opt/certbot/lib/python3.12/site-packages/urllib3/connectionpool.py:1097: InsecureRequestWarning: Unverified HTTPS request is being made to host 'pebble'. Adding certificate verification is strongly advised.",
	"  warnings.warn(",
];
const DEBUG = "Saving debug log to /tmp/acme-register-Ab12Cd/logs/letsencrypt.log";
const HELP = [
	"Ask for help or search for solutions at https://community.letsencrypt.org. See the logfile /tmp/acme-register-Ab12Cd/logs/letsencrypt.log or re-run Certbot with -v for more details.",
];
const NOISE = /Saving debug|InsecureRequest|warnings\.warn|Ask for help|logfile|\/tmp\//u;
const noise = (text) => NOISE.test(text);

it("keeps the CA's sentence of a Pebble EAB refusal among three warning blocks", () => {
	const out = cleanCertbotMessage(
		[
			DEBUG,
			...WARNING,
			...WARNING,
			"An unexpected error occurred:",
			...WARNING,
			"acme.messages.Error: urn:ietf:params:acme:error:malformed :: The request message was malformed :: Error verifying externalAccountBinding JWS: go-jose/go-jose: error in cryptographic primitive",
			...HELP,
		].join("\n"),
	);
	assert.equal(
		out,
		"acme.messages.Error: urn:ietf:params:acme:error:malformed :: The request message was malformed :: Error verifying externalAccountBinding JWS: go-jose/go-jose: error in cryptographic primitive",
	);
});

it("drops certbot's lead-in and keeps the CA's sentence of an invalid-email refusal", () => {
	const out = cleanCertbotMessage(
		[
			DEBUG,
			"",
			"Unable to register an account with ACME server. The ACME server believes ops@example.com is an invalid email address. Please ensure it is a valid email and attempt registration again.",
			...HELP,
		].join("\n"),
	);
	assert.equal(
		out,
		"The ACME server believes ops@example.com is an invalid email address. Please ensure it is a valid email and attempt registration again.",
	);
	assert.ok(!noise(out));
});

it("keeps certbot's lead-in when no CA sentence follows it", () => {
	assert.equal(
		cleanCertbotMessage("Unable to register an account with ACME server."),
		"Unable to register an account with ACME server.",
	);
});

it("keeps the text after the CA marker of a bad-nonce unregister failure", () => {
	const out = cleanCertbotMessage(
		[
			DEBUG,
			"Error returned by the ACME server:",
			"urn:ietf:params:acme:error:badNonce :: JWS has an invalid anti-replay nonce",
			...HELP,
		].join("\n"),
	);
	assert.equal(out, "urn:ietf:params:acme:error:badNonce :: JWS has an invalid anti-replay nonce");
	assert.equal(
		cleanCertbotMessage("Error returned by the ACME server: JWS has an invalid anti-replay nonce"),
		"JWS has an invalid anti-replay nonce",
	);
});

it("keeps what follows an unexpected-error marker without a CA sentence", () => {
	const out = cleanCertbotMessage(
		[DEBUG, "An unexpected error occurred:", "ConnectionError: refused", ...HELP].join("\n"),
	);
	assert.equal(out, "ConnectionError: refused");
});

it("falls back to a generic text when only noise or nothing is left", () => {
	assert.equal(cleanCertbotMessage([DEBUG, ...WARNING, ...HELP].join("\n")), GENERIC);
	assert.equal(cleanCertbotMessage(""), GENERIC);
	assert.equal(cleanCertbotMessage(undefined), GENERIC);
	assert.equal(cleanCertbotMessage("  \n \r\n"), GENERIC);
});

it("keeps a line after a warning block that is not indented", () => {
	assert.equal(cleanCertbotMessage([...WARNING, "The CA said no"].join("\r\n")), "The CA said no");
});

it("cuts a long message", () => {
	const out = cleanCertbotMessage("x".repeat(3000));
	assert.equal(out.length, MAX_CLEAN);
	assert.ok(out.endsWith("..."));
	assert.equal(cleanCertbotMessage("a".repeat(MAX_CLEAN)), "a".repeat(MAX_CLEAN));
});

it("keeps the lines of a two-domain failed authentication and its hint for a certificate request", () => {
	const out = cleanCertbotMessage(
		[
			DEBUG,
			"Requesting a certificate for a.example.com and b.example.com",
			"",
			"Certbot failed to authenticate some domains (authenticator: webroot). The Certificate Authority reported these problems:",
			"  Domain: a.example.com",
			"  Type:   unauthorized",
			"  Detail: 192.0.2.1: Invalid response from http://a.example.com/.well-known/acme-challenge/x: 404",
			"",
			"  Domain: b.example.com",
			"  Type:   connection",
			"  Detail: 192.0.2.1: Fetching http://b.example.com/.well-known/acme-challenge/y: Timeout during connect",
			"",
			"Hint: The Certificate Authority failed to download the temporary challenge files created by Certbot.",
			"Some challenges have failed.",
			...HELP,
		].join("\n"),
		{ keepLines: true, max: REQUEST_MAX },
	);
	const lines = out.split("\n");
	assert.ok(lines.includes("Domain: a.example.com"));
	assert.ok(lines.includes("Domain: b.example.com"));
	assert.ok(lines.some((line) => line.startsWith("Hint: The Certificate Authority failed to download")));
	assert.ok(lines.includes("Some challenges have failed."));
	assert.ok(out.length > MAX_CLEAN);
	assert.ok(!noise(out));
	assert.equal(cleanCertbotMessage("x".repeat(5000), { keepLines: true, max: REQUEST_MAX }).length, REQUEST_MAX);
});

it("drops any Python warning block, not only InsecureRequestWarning", () => {
	const output = [
		"/opt/certbot/lib/python3.12/site-packages/josepy/util.py:12: CryptographyDeprecationWarning: TripleDES has been moved",
		"  from cryptography.hazmat.primitives.ciphers.algorithms import TripleDES",
		"/opt/certbot/lib/python3.12/site-packages/acme/client.py:40: DeprecationWarning: a deprecated call",
		"  return thing()",
		"/x/y.py:3: UserWarning: something else",
		"Error returned by the ACME server: The CA said no",
	].join("\n");
	assert.equal(cleanCertbotMessage(output), "The CA said no");
	assert.equal(cleanCertbotMessage(output, { keepLines: true }), "The CA said no");
});

it("keeps a line that only mentions a warning in the CA's sentence", () => {
	assert.equal(
		cleanCertbotMessage("Error returned by the ACME server: Warning: the rate limit is near"),
		"Warning: the rate limit is near",
	);
});
