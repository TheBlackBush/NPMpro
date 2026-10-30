/**
 * The rules of the host windows (redirection hosts, 404 hosts, streams, and the TLS tab every host window shares) on
 * React Hook Form: their starting values, their validate functions (built from the rules their Formik fields had),
 * what a TLS choice changes and hides, and the request a save sends. Pure, so node --test checks them without a DOM.
 */
import { dnsChallengeRules } from "./CertificateForms.js";
import { fieldsValidate } from "./HookForm.js";
import { HOST_PATTERN } from "./ValidationRules.js";

// the backend's rules (schema/components/stream-object.json), plus the port range nothing checked before
const SINGLE_PORT = /^[0-9]{1,5}$/u;
const PORT_RANGE = /^(?<from>[0-9]{1,5})(?:-(?<to>[0-9]{1,5}))?$/u;
const isPort = (text) => text !== undefined && Number(text) >= 1 && Number(text) <= 65535;
// a proxy target: a host with an optional /path (schema/components/proxy-host-object.json)
const FORWARD_HOST = /^[^\s/;{}"'\\#]{0,253}(?:\/[^\s;{}"'\\#]*)?$/u;

/**
 * The fields of a certificate request (certificate "new"), with their starting values. They only exist in the
 * request while a certificate is requested (requestValues), as the Formik windows left them out.
 */
export const CERTIFICATE_REQUEST_DEFAULTS = Object.freeze({
	npmproReuseKey: false,
	npmproDnsChallenge: false,
	npmproDnsProvider: "",
	npmproDnsCredentialId: null,
	npmproPropagationSeconds: 0,
});

// the DNS challenge box: provider, credential, propagation time
const DNS_FIELDS = ["npmproDnsProvider", "npmproDnsCredentialId", "npmproPropagationSeconds"];

const without = (values, names) => Object.fromEntries(Object.entries(values).filter(([key]) => !names.includes(key)));

/**
 * The flags of a host window's DomainNamesField (wildcards, hints, the certificate's domain rules): a requested
 * certificate checks the domains as certificate names, with wildcards only over the DNS challenge. A stream (forHttp
 * false) shows the field only for a requested certificate, always with wildcards.
 *
 * @param   {Object}  values
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]  false for a stream
 * @returns {{ isWildcardPermitted: boolean, dnsProviderWildcardSupported: boolean, forCertificate: boolean }}
 */
export function domainNamesOptions(values, { forHttp = true } = {}) {
	if (!forHttp) return { isWildcardPermitted: true, dnsProviderWildcardSupported: true, forCertificate: true };
	const forCertificate = values.certificateId === "new";
	return {
		isWildcardPermitted: !forCertificate || Boolean(values.npmproDnsChallenge),
		dnsProviderWildcardSupported: true,
		forCertificate,
	};
}

/**
 * The rule of the domain names for the flags of domainNamesOptions (the rule DomainNamesField had in Formik)
 *
 * @param   {Object} rules    createValidations(intl)
 * @param   {Object} options  domainNamesOptions(...)
 * @returns {Function}
 */
export const domainNamesRule = (rules, options) =>
	rules.validateDomains(options.isWildcardPermitted && options.dnsProviderWildcardSupported, options.forCertificate);

/**
 * The rules of the TLS tab: the domain names of a stream's requested certificate, the DNS challenge box while it
 * shows (a requested certificate over the DNS challenge)
 *
 * @param   {Object}  rules
 * @param   {Object}  values
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]
 * @returns {Object}  path -> rule
 */
export function tlsRules(rules, values, { forHttp = true } = {}) {
	if (values.certificateId !== "new") return {};
	return {
		...(forHttp ? {} : { domainNames: domainNamesRule(rules, domainNamesOptions(values, { forHttp })) }),
		...(values.npmproDnsChallenge ? dnsChallengeRules(rules, values) : {}),
	};
}

/**
 * The fields a change on the TLS tab sets: the changed field, plus what it turns off or on, as the Formik
 * SSLCertificateField and SSLOptionsFields did. No certificate: no mTLS and (HTTP hosts) no HTTPS options; another
 * certificate than a requested one: no request fields; a stream's requested certificate uses the DNS challenge; the
 * DNS challenge off empties its box; HTTPS off turns HSTS off; an mTLS certificate without optional verification
 * forces HTTPS (HTTP hosts).
 *
 * @param   {Object}  values   the form's values before the change
 * @param   {string}  name     certificateId, npmproMtlsCertificateId or a TLS switch
 * @param   {*}       value
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]
 * @returns {Object}  name -> value, the changed field first
 */
export function tlsChanges(values, name, value, { forHttp = true } = {}) {
	const changes = { [name]: value };
	if (name === "certificateId") {
		if (!(value > 0)) {
			changes.npmproMtlsCertificateId = 0;
			changes.npmproMtlsVerifyClientOptional = false;
		}
		if (forHttp && !value) {
			Object.assign(changes, {
				sslForced: false,
				npmproHttp3Support: false,
				hstsEnabled: false,
				hstsSubdomains: false,
			});
		}
		if (value !== "new") Object.assign(changes, CERTIFICATE_REQUEST_DEFAULTS);
		else if (!forHttp) changes.npmproDnsChallenge = true;
	}
	if (name === "npmproMtlsCertificateId" && !(value > 0)) changes.npmproMtlsVerifyClientOptional = false;
	if (name === "npmproDnsChallenge" && !value) {
		Object.assign(changes, without(CERTIFICATE_REQUEST_DEFAULTS, ["npmproReuseKey", "npmproDnsChallenge"]));
	}
	if (name === "sslForced" && !value) Object.assign(changes, { hstsEnabled: false, hstsSubdomains: false });
	if (name === "hstsEnabled" && !value) changes.hstsSubdomains = false;
	const next = { ...values, ...changes };
	if (forHttp && next.npmproMtlsCertificateId > 0 && !next.npmproMtlsVerifyClientOptional && !next.sslForced) {
		changes.sslForced = true;
	}
	return changes;
}

/**
 * The TLS fields with rules that the values do not show (their messages go): a stream's certificate domain names
 * without a requested certificate, the DNS challenge box without a requested certificate over the DNS challenge
 *
 * @param   {Object}  values
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]
 * @returns {string[]}
 */
export function hiddenTlsFields(values, { forHttp = true } = {}) {
	const requested = values.certificateId === "new";
	return [
		...(!forHttp && !requested ? ["domainNames"] : []),
		...(requested && values.npmproDnsChallenge ? [] : DNS_FIELDS),
	];
}

/**
 * The values without the request fields a save does not send: all of them without a requested certificate, the DNS
 * challenge box without the DNS challenge
 *
 * @param   {Object} values
 * @returns {Object}
 */
export function requestValues(values) {
	if (values.certificateId !== "new") return without(values, Object.keys(CERTIFICATE_REQUEST_DEFAULTS));
	return values.npmproDnsChallenge ? values : without(values, DNS_FIELDS);
}

/**
 * The message of a forward host (the backend's rules: required, no whitespace or nginx syntax characters): a
 * redirection host's domain or a stream's host up to 253 characters; a proxy host's or a location's target (proxy)
 * up to 255 with an optional /path, and none for the "empty" scheme
 *
 * @param   {Object}  rules    createValidations(intl)
 * @param   {*}       value
 * @param   {Object}  [options]
 * @param   {boolean} [options.proxy]   a proxy host or location target
 * @param   {string}  [options.scheme]  the proxy target's forward scheme
 * @returns {string|undefined}
 */
export function forwardHostError(rules, value, { proxy = false, scheme } = {}) {
	if (!proxy) {
		return rules.validateText({ required: true, max: 253, pattern: HOST_PATTERN, messageId: "error.invalid-host" })(
			value,
		);
	}
	if (scheme === "empty") return;
	const host = String(value ?? "").trim();
	if (host === "") return rules.message("error.required");
	if (host.length > 255 || !FORWARD_HOST.test(host)) return rules.message("error.invalid-host");
}

/**
 * The starting values of a redirection host (a new one has the defaults of useRedirectionHost), in the window's order
 *
 * @param   {Object} data
 * @returns {Object}
 */
export const redirectionHostDefaults = (data) => ({
	domainNames: data.domainNames,
	forwardScheme: data.forwardScheme,
	forwardDomainName: data.forwardDomainName,
	forwardHttpCode: data.forwardHttpCode,
	preservePath: data.preservePath,
	certificateId: data.certificateId,
	npmproMtlsCertificateId: data.npmproMtlsCertificateId,
	npmproMtlsVerifyClientOptional: data.npmproMtlsVerifyClientOptional,
	sslForced: data.sslForced,
	npmproHttp3Support: data.npmproHttp3Support,
	hstsEnabled: data.hstsEnabled,
	hstsSubdomains: data.hstsSubdomains,
	...CERTIFICATE_REQUEST_DEFAULTS,
	advancedConfig: data.advancedConfig,
	npmproDirectory: data.npmproDirectory,
});

/**
 * Redirection host: the domain names, the forward domain (required, at most 253, the backend's host rule), the TLS tab
 */
export const redirectionHostValidate = (rules) =>
	fieldsValidate((values) => ({
		domainNames: domainNamesRule(rules, domainNamesOptions(values)),
		forwardDomainName: (value) => forwardHostError(rules, value),
		...tlsRules(rules, values),
	}));

/**
 * The starting values of a 404 host
 *
 * @param   {Object} data
 * @returns {Object}
 */
export const deadHostDefaults = (data) => ({
	domainNames: data.domainNames,
	certificateId: data.certificateId,
	npmproMtlsCertificateId: data.npmproMtlsCertificateId,
	npmproMtlsVerifyClientOptional: data.npmproMtlsVerifyClientOptional,
	sslForced: data.sslForced,
	npmproHttp3Support: data.npmproHttp3Support,
	hstsEnabled: data.hstsEnabled,
	hstsSubdomains: data.hstsSubdomains,
	...CERTIFICATE_REQUEST_DEFAULTS,
	advancedConfig: data.advancedConfig,
	npmproDirectory: data.npmproDirectory,
});

/**
 * 404 host: the domain names and the TLS tab
 */
export const deadHostValidate = (rules) =>
	fieldsValidate((values) => ({
		domainNames: domainNamesRule(rules, domainNamesOptions(values)),
		...tlsRules(rules, values),
	}));

/**
 * The starting values of a stream; its domain names only belong to a requested certificate
 *
 * @param   {Object} data
 * @returns {Object}
 */
export const streamDefaults = (data) => ({
	incomingPort: data.incomingPort,
	npmproDescription: data.npmproDescription,
	forwardingHost: data.forwardingHost,
	forwardingPort: data.forwardingPort,
	tcpForwarding: data.tcpForwarding,
	udpForwarding: data.udpForwarding,
	npmproProxyTls: data.npmproProxyTls,
	npmproProxyProtocolForwarding: data.npmproProxyProtocolForwarding,
	certificateId: data.certificateId,
	npmproMtlsCertificateId: data.npmproMtlsCertificateId,
	npmproMtlsVerifyClientOptional: data.npmproMtlsVerifyClientOptional,
	npmproReuseKey: false,
	npmproDnsChallenge: false,
	domainNames: [],
	npmproDnsProvider: "",
	npmproDnsCredentialId: null,
	npmproPropagationSeconds: 0,
	npmproAdvancedConfig: data.npmproAdvancedConfig,
	npmproDirectory: data.npmproDirectory,
});

/**
 * Stream: the incoming port (a port or a range), the description (at most 255), the forward host, the forward port
 * (a port, $server_port or empty), the TLS tab
 */
export const streamValidate = (rules) =>
	fieldsValidate((values) => ({
		incomingPort: (value) => {
			const text = String(value ?? "").trim();
			if (text === "") return rules.message("error.required");
			const match = PORT_RANGE.exec(text);
			const valid =
				match && isPort(match.groups.from) && (match.groups.to === undefined || isPort(match.groups.to));
			return valid ? undefined : rules.message("stream.incoming-port.invalid");
		},
		npmproDescription: rules.validateString(0, 255),
		forwardingHost: (value) => forwardHostError(rules, value),
		forwardingPort: (value) => {
			const text = String(value ?? "").trim();
			if (text === "" || text === "$server_port" || (SINGLE_PORT.test(text) && isPort(text))) return;
			return rules.message("stream.forward-port.invalid");
		},
		...tlsRules(rules, values, { forHttp: false }),
	}));

/**
 * Without a certificate "TLS to upstream" would downgrade the stream to plain text
 *
 * @param   {Object} values
 * @returns {boolean}
 */
export const isProxyTlsPossible = (values) =>
	!values.udpForwarding && (values.certificateId === "new" || values.certificateId > 0);

/**
 * The fields a TCP or UDP switch sets: one of them stays on; UDP has no TLS and no certificate, and sends PROXY
 * protocol v2 only
 *
 * @param   {Object}  values
 * @param   {string}  name     tcpForwarding or udpForwarding
 * @param   {boolean} checked
 * @returns {Object}  name -> value, the switch first
 */
export function forwardingChanges(values, name, checked) {
	if (checked && name === "tcpForwarding") return { tcpForwarding: true };
	if (!checked && name === "udpForwarding") return { udpForwarding: false, tcpForwarding: true };
	return {
		[name]: checked,
		...(name === "tcpForwarding" ? { udpForwarding: true } : {}),
		...(values.npmproProxyProtocolForwarding === 1 ? { npmproProxyProtocolForwarding: 2 } : {}),
		npmproProxyTls: false,
		...tlsChanges(values, "certificateId", 0, { forHttp: false }),
	};
}

/**
 * The request of a stream: the domain names only for a requested certificate, TLS to upstream only where possible
 *
 * @param   {Object} values
 * @returns {Object}
 */
export const streamPayload = (values) => ({
	...requestValues(values),
	domainNames: values.certificateId === "new" ? values.domainNames : undefined,
	npmproProxyTls: values.npmproProxyTls && isProxyTlsPossible(values),
});
