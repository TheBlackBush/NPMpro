import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import { fieldPaths } from "./HookForm.js";
import {
	CERTIFICATE_REQUEST_DEFAULTS,
	DEAD_HOST_TABS,
	deadHostDefaults,
	deadHostValidate,
	domainNamesOptions,
	forwardHostError,
	forwardingChanges,
	hiddenTlsFields,
	isProxyTlsPossible,
	REDIRECTION_HOST_TABS,
	redirectionHostDefaults,
	redirectionHostValidate,
	requestValues,
	STREAM_TABS,
	streamDefaults,
	streamPayload,
	streamValidate,
	tlsChanges,
	tlsQueriesSettled,
} from "./HostForms.js";
import { tabOfPath } from "./ModalTabs.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

const newRedirection = {
	id: 0,
	domainNames: [],
	forwardDomainName: "",
	preservePath: false,
	certificateId: 0,
	sslForced: false,
	advancedConfig: "",
	npmproDirectory: "",
	npmproMtlsCertificateId: 0,
	npmproMtlsVerifyClientOptional: false,
	npmproHttp3Support: false,
	forwardScheme: "$scheme",
	forwardHttpCode: 301,
	hstsEnabled: false,
	hstsSubdomains: false,
};

const newStream = {
	id: 0,
	incomingPort: "",
	forwardingHost: "",
	forwardingPort: "",
	tcpForwarding: true,
	udpForwarding: false,
	npmproProxyProtocolForwarding: 0,
	npmproProxyTls: false,
	npmproAdvancedConfig: "",
	npmproDirectory: "",
	npmproMtlsCertificateId: 0,
	npmproMtlsVerifyClientOptional: false,
	certificateId: 0,
	npmproDescription: "",
};

it("gives DomainNamesField the flags its rule uses: certificate names, wildcards only over DNS", () => {
	assert.deepEqual(domainNamesOptions({ certificateId: 0 }), {
		isWildcardPermitted: true,
		dnsProviderWildcardSupported: true,
		forCertificate: false,
	});
	assert.deepEqual(domainNamesOptions({ certificateId: "new", npmproDnsChallenge: false }), {
		isWildcardPermitted: false,
		dnsProviderWildcardSupported: true,
		forCertificate: true,
	});
	assert.deepEqual(domainNamesOptions({ certificateId: "new", npmproDnsChallenge: true }), {
		isWildcardPermitted: true,
		dnsProviderWildcardSupported: true,
		forCertificate: true,
	});
	assert.deepEqual(domainNamesOptions({ certificateId: 0 }, { forHttp: false }), {
		isWildcardPermitted: true,
		dnsProviderWildcardSupported: true,
		forCertificate: true,
	});
});

it("redirection host: the same errors as the Formik fields", () => {
	const validate = redirectionHostValidate(rules);
	const fresh = redirectionHostDefaults(newRedirection);
	assert.deepEqual(validate(fresh), { domainNames: "This is required", forwardDomainName: "This is required" });
	assert.deepEqual(validate({ ...fresh, domainNames: ["*.example.com"], forwardDomainName: "a b" }), {
		forwardDomainName: "Must not contain spaces or the characters ; { } \" ' \\ #",
	});
	assert.deepEqual(validate({ ...fresh, domainNames: ["example.com"], forwardDomainName: "x".repeat(254) }), {
		forwardDomainName: "Maximum length is 253 characters",
	});
	// a requested certificate: certificate names, wildcards only over DNS, then the DNS box
	const requested = {
		...fresh,
		domainNames: ["*.example.com"],
		forwardDomainName: "target.com",
		certificateId: "new",
	};
	assert.deepEqual(validate(requested), { domainNames: "Invalid domain: *.example.com" });
	assert.deepEqual(validate({ ...requested, npmproDnsChallenge: true }), { npmproDnsProvider: "This is required" });
	assert.deepEqual(
		validate({
			...requested,
			npmproDnsChallenge: true,
			npmproDnsProvider: "hetzner",
			npmproPropagationSeconds: 7201,
		}),
		{ npmproDnsCredentialId: "This is required", npmproPropagationSeconds: "Enter a whole number from 0 to 7200" },
	);
	assert.deepEqual(
		validate({ ...requested, npmproDnsChallenge: true, npmproDnsProvider: "hetzner", npmproDnsCredentialId: 3 }),
		{},
	);
});

it("404 host: the same errors as the Formik fields", () => {
	const validate = deadHostValidate(rules);
	const fresh = deadHostDefaults({ ...newRedirection, forwardDomainName: undefined });
	assert.deepEqual(validate(fresh), { domainNames: "This is required" });
	assert.deepEqual(validate({ ...fresh, domainNames: ["a b"] }), { domainNames: "Invalid domain: a b" });
	assert.deepEqual(validate({ ...fresh, domainNames: ["example.com"] }), {});
	assert.deepEqual(
		validate({ ...fresh, domainNames: ["example.com"], certificateId: "new", npmproDnsChallenge: true }),
		{
			npmproDnsProvider: "This is required",
		},
	);
});

it("stream: the same errors as the Formik fields", () => {
	const validate = streamValidate(rules);
	const fresh = streamDefaults(newStream);
	assert.deepEqual(validate(fresh), { incomingPort: "This is required", forwardingHost: "This is required" });
	const filled = { ...fresh, incomingPort: "8080", forwardingHost: "10.0.0.1" };
	assert.deepEqual(validate(filled), {});
	assert.deepEqual(validate({ ...filled, incomingPort: "8000-8100", forwardingPort: "$server_port" }), {});
	assert.deepEqual(
		validate({ ...filled, incomingPort: "70000", forwardingPort: "0", npmproDescription: "d".repeat(256) }),
		{
			incomingPort: "Enter a port from 1 to 65535 or a range such as 8000-8100",
			npmproDescription: "Maximum length is 255 characters",
			forwardingPort: "Enter a port from 1 to 65535, $server_port, or leave it empty",
		},
	);
	// a requested certificate: its domain names with wildcards, the DNS challenge (always on for streams)
	assert.deepEqual(validate({ ...filled, certificateId: "new", npmproDnsChallenge: true }), {
		domainNames: "This is required",
		npmproDnsProvider: "This is required",
	});
	assert.deepEqual(
		validate({
			...filled,
			certificateId: "new",
			npmproDnsChallenge: true,
			domainNames: ["*.example.com"],
			npmproDnsProvider: "hetzner",
			npmproDnsCredentialId: 3,
		}),
		{},
	);
});

it("starts every window with complete values in the window's order", () => {
	assert.deepEqual(Object.keys(redirectionHostDefaults(newRedirection)), [
		"domainNames",
		"forwardScheme",
		"forwardDomainName",
		"forwardHttpCode",
		"preservePath",
		"certificateId",
		"npmproMtlsCertificateId",
		"npmproMtlsVerifyClientOptional",
		"sslForced",
		"npmproHttp3Support",
		"hstsEnabled",
		"hstsSubdomains",
		"npmproReuseKey",
		"npmproDnsChallenge",
		"npmproDnsProvider",
		"npmproDnsCredentialId",
		"npmproPropagationSeconds",
		"advancedConfig",
		"npmproDirectory",
	]);
	const stream = streamDefaults(newStream);
	assert.equal(
		Object.values(stream).some((value) => value === undefined),
		false,
	);
	assert.deepEqual(Object.keys(stream).slice(11, 17), [
		"npmproReuseKey",
		"npmproDnsChallenge",
		"domainNames",
		"npmproDnsProvider",
		"npmproDnsCredentialId",
		"npmproPropagationSeconds",
	]);
});

// the fields of the starting values that sit on no tab or on more than one
const misplacedFields = (tabs, values) =>
	fieldPaths(values).filter((path) => tabs.filter((tab) => tabOfPath([tab], path) !== null).length !== 1);

it("puts every field of the redirection host, 404 host and stream windows on exactly one tab, Advanced last", () => {
	assert.deepEqual(misplacedFields(REDIRECTION_HOST_TABS, redirectionHostDefaults(newRedirection)), []);
	assert.deepEqual(misplacedFields(DEAD_HOST_TABS, deadHostDefaults(newRedirection)), []);
	assert.deepEqual(misplacedFields(STREAM_TABS, streamDefaults(newStream)), []);
	for (const tabs of [REDIRECTION_HOST_TABS, DEAD_HOST_TABS, STREAM_TABS]) {
		assert.deepEqual(
			tabs.map((tab) => [tab.id, tab.labelId, Boolean(tab.end)]),
			[
				["details", "column.details", false],
				["tls", "column.ssl", false],
				["advanced", "domains.advanced", true],
			],
		);
	}
	// a stream's domain names belong to its requested certificate, a redirection host's to its details
	assert.equal(tabOfPath(STREAM_TABS, "domainNames"), "tls");
	assert.equal(tabOfPath(REDIRECTION_HOST_TABS, "domainNames"), "details");
	assert.equal(tabOfPath(STREAM_TABS, "npmproAdvancedConfig"), "advanced");
	assert.equal(tabOfPath(DEAD_HOST_TABS, "npmproDnsCredentialId"), "tls");
});

it("sets what a certificate choice turns off, as the Formik certificate field did", () => {
	const values = {
		certificateId: "new",
		npmproMtlsCertificateId: 4,
		npmproMtlsVerifyClientOptional: true,
		sslForced: true,
		npmproHttp3Support: true,
		hstsEnabled: true,
		hstsSubdomains: true,
		npmproDnsChallenge: true,
		npmproDnsProvider: "hetzner",
	};
	assert.deepEqual(tlsChanges(values, "certificateId", 0), {
		certificateId: 0,
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
		sslForced: false,
		npmproHttp3Support: false,
		hstsEnabled: false,
		hstsSubdomains: false,
		...CERTIFICATE_REQUEST_DEFAULTS,
	});
	assert.deepEqual(tlsChanges(values, "certificateId", 7), { certificateId: 7, ...CERTIFICATE_REQUEST_DEFAULTS });
	assert.deepEqual(tlsChanges({ certificateId: 0 }, "certificateId", "new"), {
		certificateId: "new",
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
	});
	// a stream requests certificates over DNS only, and has no HTTPS options
	assert.deepEqual(tlsChanges({ certificateId: 0 }, "certificateId", "new", { forHttp: false }), {
		certificateId: "new",
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
		npmproDnsChallenge: true,
	});
});

it("sets what a TLS switch or the mTLS certificate turns off or on, as the Formik TLS fields did", () => {
	assert.deepEqual(tlsChanges({}, "npmproDnsChallenge", false), {
		npmproDnsChallenge: false,
		npmproDnsProvider: "",
		npmproDnsCredentialId: null,
		npmproPropagationSeconds: 0,
	});
	assert.deepEqual(tlsChanges({}, "sslForced", false), {
		sslForced: false,
		hstsEnabled: false,
		hstsSubdomains: false,
	});
	assert.deepEqual(tlsChanges({}, "hstsEnabled", false), { hstsEnabled: false, hstsSubdomains: false });
	assert.deepEqual(tlsChanges({}, "npmproReuseKey", true), { npmproReuseKey: true });
	// an mTLS certificate without optional verification forces HTTPS on HTTP hosts
	const withCertificate = { certificateId: 3, npmproMtlsCertificateId: 0, sslForced: false };
	assert.deepEqual(tlsChanges(withCertificate, "npmproMtlsCertificateId", 9), {
		npmproMtlsCertificateId: 9,
		sslForced: true,
	});
	assert.deepEqual(tlsChanges(withCertificate, "npmproMtlsCertificateId", 9, { forHttp: false }), {
		npmproMtlsCertificateId: 9,
	});
	assert.deepEqual(
		tlsChanges(
			{ ...withCertificate, npmproMtlsCertificateId: 9, npmproMtlsVerifyClientOptional: true },
			"npmproMtlsVerifyClientOptional",
			false,
		),
		{ npmproMtlsVerifyClientOptional: false, sslForced: true },
	);
	assert.deepEqual(tlsChanges({ ...withCertificate, npmproMtlsCertificateId: 9 }, "npmproMtlsCertificateId", 0), {
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
	});
});

it("names the TLS fields with rules that a choice hides", () => {
	assert.deepEqual(hiddenTlsFields({ certificateId: 0 }), [
		"npmproDnsProvider",
		"npmproDnsCredentialId",
		"npmproPropagationSeconds",
	]);
	assert.deepEqual(hiddenTlsFields({ certificateId: "new", npmproDnsChallenge: false }), [
		"npmproDnsProvider",
		"npmproDnsCredentialId",
		"npmproPropagationSeconds",
	]);
	assert.deepEqual(hiddenTlsFields({ certificateId: "new", npmproDnsChallenge: true }), []);
	assert.deepEqual(hiddenTlsFields({ certificateId: 0 }, { forHttp: false }), [
		"domainNames",
		"npmproDnsProvider",
		"npmproDnsCredentialId",
		"npmproPropagationSeconds",
	]);
	assert.deepEqual(hiddenTlsFields({ certificateId: "new", npmproDnsChallenge: true }, { forHttp: false }), []);
});

it("sends the request fields only for a requested certificate, the DNS box only over DNS", () => {
	const values = { domainNames: ["a.com"], certificateId: 5, ...CERTIFICATE_REQUEST_DEFAULTS };
	assert.deepEqual(requestValues(values), { domainNames: ["a.com"], certificateId: 5 });
	assert.deepEqual(requestValues({ ...values, certificateId: "new", npmproReuseKey: true }), {
		domainNames: ["a.com"],
		certificateId: "new",
		npmproReuseKey: true,
		npmproDnsChallenge: false,
	});
	const dns = {
		...values,
		certificateId: "new",
		npmproDnsChallenge: true,
		npmproDnsProvider: "hetzner",
		npmproDnsCredentialId: 3,
	};
	assert.deepEqual(requestValues(dns), dns);
});

it("stream: keeps TCP or UDP on and drops TLS and the certificate with UDP", () => {
	const values = { npmproProxyProtocolForwarding: 1, certificateId: "new", npmproMtlsCertificateId: 2 };
	const tlsOff = {
		npmproProxyTls: false,
		certificateId: 0,
		npmproMtlsCertificateId: 0,
		npmproMtlsVerifyClientOptional: false,
		...CERTIFICATE_REQUEST_DEFAULTS,
	};
	assert.deepEqual(forwardingChanges(values, "tcpForwarding", false), {
		tcpForwarding: false,
		udpForwarding: true,
		npmproProxyProtocolForwarding: 2,
		...tlsOff,
	});
	assert.deepEqual(forwardingChanges({ ...values, npmproProxyProtocolForwarding: 0 }, "udpForwarding", true), {
		udpForwarding: true,
		...tlsOff,
	});
	assert.deepEqual(forwardingChanges(values, "udpForwarding", false), { udpForwarding: false, tcpForwarding: true });
	assert.deepEqual(forwardingChanges(values, "tcpForwarding", true), { tcpForwarding: true });
});

it("stream: the request has domain names only for a requested certificate, TLS only where possible", () => {
	const values = { ...streamDefaults(newStream), incomingPort: "80", forwardingHost: "h", npmproProxyTls: true };
	const saved = streamPayload(values);
	assert.equal(saved.domainNames, undefined);
	assert.equal(saved.npmproProxyTls, false);
	assert.equal("npmproDnsProvider" in saved, false);
	assert.equal(isProxyTlsPossible({ certificateId: 3, udpForwarding: false }), true);
	assert.equal(isProxyTlsPossible({ certificateId: 3, udpForwarding: true }), false);
	const requested = streamPayload({
		...values,
		certificateId: "new",
		npmproDnsChallenge: true,
		domainNames: ["a.com"],
		npmproDnsProvider: "hetzner",
		npmproDnsCredentialId: 3,
	});
	assert.deepEqual(requested.domainNames, ["a.com"]);
	assert.equal(requested.npmproProxyTls, true);
	assert.equal(requested.npmproDnsCredentialId, 3);
});

it("checks a forward host with one rule: up to 253 for a domain, a /path and 255 for a proxy target", () => {
	assert.equal(forwardHostError(rules, ""), "This is required");
	assert.equal(forwardHostError(rules, "example.com"), undefined);
	assert.equal(forwardHostError(rules, "x".repeat(254)), "Maximum length is 253 characters");
	assert.equal(forwardHostError(rules, "a;b"), "Must not contain spaces or the characters ; { } \" ' \\ #");
	assert.equal(forwardHostError(rules, " ", { proxy: true, scheme: "http" }), "This is required");
	assert.equal(forwardHostError(rules, "", { proxy: true, scheme: "empty" }), undefined);
	assert.equal(forwardHostError(rules, "10.0.0.1/app", { proxy: true, scheme: "http" }), undefined);
	assert.equal(
		forwardHostError(rules, "a/b/c d", { proxy: true, scheme: "http" }),
		"Must not contain spaces or the characters ; { } \" ' \\ #",
	);
	assert.equal(
		forwardHostError(rules, "x".repeat(256), { proxy: true, scheme: "path" }),
		"Must not contain spaces or the characters ; { } \" ' \\ #",
	);
});

it("tlsQueriesSettled: waits for the user and the DNS providers, the certificates only for a user who may read them", () => {
	const loaded = (data) => ({ isPending: false, failureCount: 0, data });
	const loading = { isPending: true, failureCount: 0, data: undefined };
	const retrying = { isPending: true, failureCount: 1, data: undefined };
	const admin = loaded({ roles: ["admin"], permissions: {} });
	const viewer = loaded({ roles: [], permissions: { certificates: "view" } });
	const noCertificates = loaded({ roles: [], permissions: { certificates: "hidden" } });
	const all = { user: admin, certificates: loaded([]), dnsProviders: loaded([]) };
	assert.equal(tlsQueriesSettled(all), true);
	assert.equal(tlsQueriesSettled({ ...all, user: loading }), false);
	assert.equal(tlsQueriesSettled({ ...all, dnsProviders: loading }), false);
	assert.equal(tlsQueriesSettled({ ...all, certificates: loading }), false);
	assert.equal(tlsQueriesSettled({ ...all, user: viewer, certificates: loading }), false);
	// no wait behind the spinner while a failed read retries, nor for a read the user may not make
	assert.equal(tlsQueriesSettled({ ...all, certificates: retrying }), true);
	assert.equal(tlsQueriesSettled({ ...all, dnsProviders: retrying }), true);
	assert.equal(tlsQueriesSettled({ ...all, user: noCertificates, certificates: loading }), true);
	// a user read that fails once counts as settled (no certificate permission known, so no wait); if it loads later as
	// a user who may read certificates that are still loading, the result turns false again: useTlsQueriesSettled
	// latches the first true, so the open form is not unmounted
	assert.equal(tlsQueriesSettled({ ...all, user: retrying, certificates: loading }), true);
	assert.equal(tlsQueriesSettled({ ...all, user: viewer, certificates: loading }), false);
});

it("tlsQueriesSettled: the proxy host window also waits for the access lists, only for a user who may read them", () => {
	const loaded = (data) => ({ isPending: false, failureCount: 0, data });
	const loading = { isPending: true, failureCount: 0, data: undefined };
	const retrying = { isPending: true, failureCount: 1, data: undefined };
	const admin = loaded({ roles: ["admin"], permissions: {} });
	const listViewer = loaded({ roles: [], permissions: { certificates: "view", accessLists: "view" } });
	const noLists = loaded({ roles: [], permissions: { certificates: "view", accessLists: "hidden" } });
	const all = { user: admin, certificates: loaded([]), dnsProviders: loaded([]), accessLists: loaded([]) };
	assert.equal(tlsQueriesSettled(all), true);
	assert.equal(tlsQueriesSettled({ ...all, accessLists: loading }), false);
	assert.equal(tlsQueriesSettled({ ...all, user: listViewer, accessLists: loading }), false);
	// a failed read that retries, or a read the user may not make, does not keep the window behind the spinner
	assert.equal(tlsQueriesSettled({ ...all, accessLists: retrying }), true);
	assert.equal(tlsQueriesSettled({ ...all, user: noLists, accessLists: loading }), true);
	// the other windows pass no access lists
	assert.equal(tlsQueriesSettled({ ...all, accessLists: undefined }), true);
});
