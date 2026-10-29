import assert from "node:assert/strict";
import { it } from "node:test";
import { assertCertificateUse, certificateFile } from "../lib/certificate-files.js";

const all = () => true;
const none = () => false;

it("names the file the templates load", () => {
	assert.equal(certificateFile({ id: 3, provider: "letsencrypt" }), "/data/tls/certbot/live/npm-3/fullchain.pem");
	assert.equal(certificateFile({ id: 4, provider: "other" }), "/data/tls/custom/npm-4/fullchain.pem");
	assert.equal(certificateFile({ id: 5, provider: "mtls" }), "/data/tls/mtls/npm-5.pem");
});

it("accepts a server certificate as certificate_id and an mTLS CA as the mTLS certificate", () => {
	assert.doesNotThrow(() => assertCertificateUse({ id: 1, provider: "letsencrypt" }, false, all));
	assert.doesNotThrow(() => assertCertificateUse({ id: 1, provider: "other" }, false, all));
	assert.doesNotThrow(() => assertCertificateUse({ id: 2, provider: "mtls" }, true, all));
});

it("refuses the wrong kind", () => {
	assert.throws(() => assertCertificateUse({ id: 2, provider: "mtls" }, false, all), {
		message_i18n: "error.certificate.is-mtls",
	});
	assert.throws(() => assertCertificateUse({ id: 1, provider: "letsencrypt" }, true, all), {
		message_i18n: "error.certificate.not-mtls",
	});
});

it("refuses a certificate without its files", () => {
	const seen = [];
	assert.throws(
		() =>
			assertCertificateUse({ id: 7, provider: "other" }, false, (file) => {
				seen.push(file);
				return none();
			}),
		{ message_i18n: "error.certificate.no-files" },
	);
	assert.deepEqual(seen, ["/data/tls/custom/npm-7/fullchain.pem"]);
});
