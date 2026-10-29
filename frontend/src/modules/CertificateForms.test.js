import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import {
	changeDnsCredentialValidate,
	credentialFieldValues,
	customCertificateValidate,
	dnsCertificateValidate,
	dnsCredentialValidate,
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

const providers = [
	{
		id: "hetzner",
		fields: [
			{ key: "token", label: "Token", type: "secret" },
			{ key: "endpoint", label: "Endpoint", type: "url", optional: true },
		],
	},
	{
		id: "split",
		fields: [
			{ key: "apiKey", label: "Key", type: "secret", group: "key" },
			{ key: "user", label: "User", type: "string", group: "login" },
			{ key: "ttl", label: "TTL", type: "number" },
		],
		oneOf: ["key", "login"],
	},
	{ id: "acmedns" },
];
const base = { name: "Main", provider: "hetzner", useIni: false, fieldValues: {}, ini: "", oneOfGroup: "" };

it("DNS credential: the name and the provider", () => {
	const validate = dnsCredentialValidate(rules, { providers, credential: {} });
	assert.deepEqual(validate({ ...base, name: "", provider: "" }), {
		name: "This is required",
		provider: "This is required",
	});
});

it("DNS credential: the shown fields, a saved secret kept when empty", () => {
	const fresh = dnsCredentialValidate(rules, { providers, credential: {} });
	assert.deepEqual(fresh(base), { fieldValues: { token: "This is required" } });
	assert.deepEqual(fresh({ ...base, fieldValues: { token: "t", endpoint: "ftp://x" } }), {
		fieldValues: { endpoint: "Enter an http:// or https:// URL" },
	});
	assert.deepEqual(fresh({ ...base, fieldValues: { token: "a\u0007b" } }), {
		fieldValues: { token: "Must not contain a line break or control character" },
	});
	const saved = { provider: "hetzner", fields: [{ key: "token", isSet: true }] };
	assert.deepEqual(dnsCredentialValidate(rules, { providers, credential: saved })(base), {});
	// the saved secret counts only while its own provider is chosen
	assert.deepEqual(dnsCredentialValidate(rules, { providers, credential: { ...saved, provider: "split" } })(base), {
		fieldValues: { token: "This is required" },
	});
});

it("DNS credential: only the fields of the chosen group", () => {
	const validate = dnsCredentialValidate(rules, { providers, credential: {} });
	const split = { ...base, provider: "split", oneOfGroup: "login", fieldValues: { ttl: "x" } };
	assert.deepEqual(validate(split), { fieldValues: { user: "This is required", ttl: "Enter a number" } });
	assert.deepEqual(validate({ ...split, oneOfGroup: "key", fieldValues: { apiKey: "k", ttl: "60" } }), {});
});

it("DNS credential: the INI text when chosen or without field definitions, kept when saved", () => {
	const validate = dnsCredentialValidate(rules, { providers, credential: {} });
	assert.deepEqual(validate({ ...base, useIni: true, fieldValues: {} }), { ini: "This is required" });
	assert.deepEqual(validate({ ...base, provider: "acmedns", useIni: true }), { ini: "This is required" });
	assert.deepEqual(validate({ ...base, useIni: true, ini: " " }), { ini: "This is required" });
	const iniSaved = dnsCredentialValidate(rules, { providers, credential: { provider: "hetzner", iniSet: true } });
	assert.deepEqual(iniSaved({ ...base, useIni: true }), {});
});

it("DNS credential: every provider field starts with its saved value or empty", () => {
	assert.deepEqual(credentialFieldValues(providers[0], null), { token: "", endpoint: "" });
	assert.deepEqual(
		credentialFieldValues(providers[0], {
			fields: [
				{ key: "token", isSet: true },
				{ key: "endpoint", value: "https://api.example.com" },
			],
		}),
		{ token: "", endpoint: "https://api.example.com" },
	);
	assert.deepEqual(credentialFieldValues(providers[2], null), {});
	assert.deepEqual(credentialFieldValues(undefined, null), {});
});
