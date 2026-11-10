import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// the object every caller imports: a split of internal/certificate.js must keep it whole
const CERTIFICATE_KEYS = [
	"addCreatedAuditLog",
	"allowedSslFiles",
	"checkPrivateKey",
	"create",
	"createQuickCertificate",
	"delete",
	"download",
	"get",
	"getAll",
	"getCertificateInfo",
	"getCertificateInfoFromFile",
	"getCount",
	"getCustomCertPath",
	"getExpiryCounts",
	"getLiveCertPath",
	"getMtlsCertFile",
	"initTimer",
	"intervalProcessing",
	"pauseRenewals",
	"performTestForDomain",
	"processExpiringHosts",
	"renew",
	"renewCertbot",
	"requestCertbot",
	"requestCertbotWithDnsChallenge",
	"restartTimer",
	"resumeRenewals",
	"revokeCertbot",
	"setDnsCredential",
	"testHttpsChallenge",
	"update",
	"upload",
	"validate",
	"writeCustomCert",
	"zipFiles",
];
let api;

before(async () => {
	api = await startApi();
});
after(() => api?.stop());

it("keeps every public name of internalCertificate", async () => {
	const { default: internalCertificate } = await import("../internal/certificate.js");
	assert.deepEqual(Object.keys(internalCertificate).sort(), CERTIFICATE_KEYS);
});

it("keeps the three paths", async () => {
	const { default: internalCertificate } = await import("../internal/certificate.js");
	assert.equal(internalCertificate.getLiveCertPath(4).replace(api.root, ""), "/data/tls/certbot/live/npm-4");
	assert.equal(internalCertificate.getCustomCertPath(4).replace(api.root, ""), "/data/tls/custom/npm-4");
	assert.equal(internalCertificate.getMtlsCertFile(4).replace(api.root, ""), "/data/tls/mtls/npm-4.pem");
});
