import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	changeDnsCredentialValidate,
	customCertificateValidate,
	dnsCertificateValidate,
	httpCertificateValidate,
} from "./CertificateForms.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

it("HTTP certificate: domain names without wildcards", () => {
	const validate = httpCertificateValidate(rules);
	assert.deepEqual(validate({ domainNames: [], provider: "letsencrypt", npmproReuseKey: false }), {
		domainNames: "This is required",
	});
	assert.deepEqual(validate({ domainNames: ["*.example.com"] }), { domainNames: "Invalid domain: *.example.com" });
	assert.deepEqual(validate({ domainNames: ["example.com"] }), {});
	assert.deepEqual(validate({ domainNames: Array.from({ length: 26 }, (_, i) => `a${i}.com`) }), {
		domainNames: "Too many domains, max is 25",
	});
});

it("DNS certificate: domains with wildcards, then the provider, and with one the credential and the wait", () => {
	const validate = dnsCertificateValidate(rules);
	assert.deepEqual(validate({ domainNames: [], provider: "letsencrypt", npmproDnsChallenge: true }), {
		domainNames: "This is required",
		npmproDnsProvider: "This is required",
	});
	assert.deepEqual(validate({ domainNames: ["*.example.com"], npmproDnsProvider: "hetzner" }), {
		npmproDnsCredentialId: "This is required",
	});
	assert.deepEqual(
		validate({
			domainNames: ["*.example.com"],
			npmproDnsProvider: "hetzner",
			npmproDnsCredentialId: 3,
			npmproPropagationSeconds: 7201,
		}),
		{ npmproPropagationSeconds: "Enter a whole number from 0 to 7200" },
	);
	assert.deepEqual(
		validate({
			domainNames: ["example.com"],
			npmproDnsProvider: "hetzner",
			npmproDnsCredentialId: 3,
			npmproPropagationSeconds: 0,
		}),
		{},
	);
});

it("custom certificate: the name only when created, the key unless an mTLS CA", () => {
	const file = { size: 10 };
	assert.deepEqual(
		customCertificateValidate(rules, { isEdit: false, isMtls: false })({
			niceName: "",
			certificate: null,
			certificateKey: null,
		}),
		{ niceName: "This is required", certificate: "This is required", certificateKey: "This is required" },
	);
	assert.deepEqual(
		customCertificateValidate(rules, { isEdit: true, isMtls: false })({
			niceName: "",
			certificate: file,
			certificateKey: null,
		}),
		{ certificateKey: "This is required" },
	);
	assert.deepEqual(
		customCertificateValidate(rules, { isEdit: false, isMtls: true })({
			niceName: "CA",
			certificate: { size: 2 * 1024 * 1024 },
			certificateKey: null,
		}),
		{ certificate: "The upload is too large, the maximum is 1 MiB" },
	);
});

it("change DNS credential: one must be chosen", () => {
	const validate = changeDnsCredentialValidate(rules);
	assert.deepEqual(validate({ npmproDnsCredentialId: undefined }), { npmproDnsCredentialId: "This is required" });
	assert.deepEqual(validate({ npmproDnsCredentialId: 4 }), {});
});
