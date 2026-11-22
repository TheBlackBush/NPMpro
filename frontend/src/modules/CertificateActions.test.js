import assert from "node:assert/strict";
import { it } from "node:test";
import { certificateActionKeys } from "./CertificateActions.js";

const le = { provider: "letsencrypt", npmproDnsChallenge: false, inUse: false };
const dns = { ...le, npmproDnsChallenge: true, npmproDnsProvider: "cloudflare" };

it("offers test, edit and renew for an HTTP Let's Encrypt certificate", () => {
	assert.deepEqual(certificateActionKeys(le, { canManage: true }), [
		"test",
		"edit",
		"renew",
		"reissue",
		"download",
		"delete",
	]);
});

it("offers no test but the DNS credential change for a DNS Let's Encrypt certificate", () => {
	assert.deepEqual(certificateActionKeys(dns, { canManage: true }), [
		"edit",
		"renew",
		"reissue",
		"change-dns",
		"download",
		"delete",
	]);
});

it("offers change-dns only with a DNS challenge", () => {
	const keys = certificateActionKeys({ ...dns, npmproDnsChallenge: false }, { canManage: true });
	assert.equal(keys.includes("change-dns"), false);
	assert.equal(keys.includes("test"), false);
});

it("offers edit but no renew and no test for an uploaded or mTLS certificate", () => {
	for (const provider of ["other", "mtls"]) {
		assert.deepEqual(certificateActionKeys({ provider, inUse: false }, { canManage: true }), [
			"edit",
			"download",
			"delete",
		]);
	}
});

it("never offers delete for a certificate in use", () => {
	assert.deepEqual(certificateActionKeys({ ...le, inUse: true }, { canManage: true }), [
		"test",
		"edit",
		"renew",
		"reissue",
		"download",
	]);
});

it("gives a view-only user nothing to run: the test writes a file, the download includes the private key", () => {
	assert.deepEqual(certificateActionKeys(le, { canManage: false }), []);
});

it("gives a view-only user nothing for a DNS or uploaded certificate", () => {
	assert.deepEqual(certificateActionKeys(dns, { canManage: false }), []);
	assert.deepEqual(certificateActionKeys({ provider: "other", inUse: false }, { canManage: false }), []);
});
