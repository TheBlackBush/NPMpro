import assert from "node:assert/strict";
import { it } from "node:test";
import { certificateActionKeys } from "./CertificateActions.js";

const le = { provider: "letsencrypt", npmproDnsChallenge: false, inUse: false };

it("offers renew but no edit for a Let's Encrypt certificate", () => {
	assert.deepEqual(certificateActionKeys(le, { canManage: true }), ["test", "renew", "download", "delete"]);
});

it("offers the DNS credential change only with a DNS challenge", () => {
	assert.deepEqual(certificateActionKeys({ ...le, npmproDnsChallenge: true }, { canManage: true }), [
		"test",
		"renew",
		"change-dns",
		"download",
		"delete",
	]);
});

it("offers edit but no renew for an uploaded or mTLS certificate", () => {
	for (const provider of ["other", "mtls"]) {
		assert.deepEqual(certificateActionKeys({ provider, inUse: false }, { canManage: true }), [
			"test",
			"edit",
			"download",
			"delete",
		]);
	}
});

it("never offers delete for a certificate in use", () => {
	assert.deepEqual(certificateActionKeys({ ...le, inUse: true }, { canManage: true }), ["test", "renew", "download"]);
});

it("gives a view-only user test and download only", () => {
	assert.deepEqual(certificateActionKeys({ ...le, npmproDnsChallenge: true }, { canManage: false }), [
		"test",
		"download",
	]);
});
