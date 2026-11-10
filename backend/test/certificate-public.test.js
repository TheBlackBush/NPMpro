import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { promisify } from "node:util";
import { startApi } from "./support/api.js";

const run = promisify(execFile);

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
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api?.stop());

it("keeps every public name and the kind of value behind it", async () => {
	const { default: internalCertificate } = await import("../internal/certificate.js");
	assert.deepEqual(Object.keys(internalCertificate).sort(), CERTIFICATE_KEYS);
	assert.deepEqual(internalCertificate.allowedSslFiles, ["certificate", "certificate_key"]);
	assert.equal(internalCertificate.intervalProcessing, false);
	for (const [name, value] of Object.entries(internalCertificate)) {
		if (name === "allowedSslFiles" || name === "intervalProcessing") continue;
		assert.equal(typeof value, "function", name);
	}
});

it("keeps the three paths", async () => {
	const { default: internalCertificate } = await import("../internal/certificate.js");
	assert.equal(internalCertificate.getLiveCertPath(4).replace(api.root, ""), "/data/tls/certbot/live/npm-4");
	assert.equal(internalCertificate.getCustomCertPath(4).replace(api.root, ""), "/data/tls/custom/npm-4");
	assert.equal(internalCertificate.getMtlsCertFile(4).replace(api.root, ""), "/data/tls/mtls/npm-4.pem");
});

// a certificate with a subject CN and no subjectAltName: the names come from the CN fallback of getCertificateInfo
it("reads the names of an uploaded certificate without subjectAltName from its CN", async () => {
	const dir = await mkdtemp(path.join(api.root, "fake/cn-"));
	const key = path.join(dir, "key.pem");
	const certificate = path.join(dir, "cert.pem");
	await run("openssl", [
		"req",
		"-x509",
		"-newkey",
		"ec",
		"-pkeyopt",
		"ec_paramgen_curve:P-256",
		"-nodes",
		"-keyout",
		key,
		"-out",
		certificate,
		"-days",
		"30",
		"-subj",
		"/CN=cn-only.example.com",
	]);
	const pem = await readFile(certificate, "utf8");
	const { X509Certificate } = await import("node:crypto");
	assert.equal(new X509Certificate(pem).subjectAltName, undefined);
	const created = await admin.post("/nginx/certificates", { provider: "other", nice_name: "CN only" });
	assert.equal(created.status, 201, created.text);
	const form = new FormData();
	form.append("certificate", new Blob([pem]), "certificate.pem");
	form.append("certificate_key", new Blob([await readFile(key, "utf8")]), "certificate_key.pem");
	const done = await admin.send("POST", `/nginx/certificates/${created.body.id}/upload`, { form });
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.domain_names, ["cn-only.example.com"]);
});
