/**
 * The rules that switch a control of a host window's TLS tab off, each with the message that says why: the HTTPS
 * options need a certificate, HSTS needs Force HTTPS, the mTLS options need an existing certificate, and so on (the
 * conditions SSLOptionsFields and SSLCertificateField had inline). A control that is not in the result is enabled.
 * Pure, so node --test checks them without a DOM.
 */
import { namedLocations } from "./ProxyHostForms.js";

// the messages; tData names the label (a translation id) the message quotes
const NO_CERTIFICATE = Object.freeze({ id: "tls.disabled.no-certificate" });
const REQUESTED_CERTIFICATE = Object.freeze({ id: "tls.disabled.requested-certificate" });
const NO_MTLS_CERTIFICATE = Object.freeze({ id: "tls.disabled.no-mtls-certificate" });
const MTLS_REQUIRED = Object.freeze({ id: "tls.disabled.mtls-required" });
const STREAM_DNS = Object.freeze({ id: "error.stream.new-certificate-dns" });
const AUTH_REQUEST = Object.freeze({ id: "tls.disabled.auth-request", tData: { option: "host.auth-request" } });
const needs = (option) => Object.freeze({ id: "tls.disabled.needs-option", tData: { option } });

/**
 * Whether "mTLS bypass Auth Request" can be used: mTLS is optional and the host or one of its custom locations
 * (rows with a path) has an Auth Request
 *
 * @param   {Object}  values
 * @returns {boolean}
 */
export function mtlsBypassPossible(values) {
	if (!values.npmproMtlsVerifyClientOptional) return false;
	return [{ npmproAuthRequest: values.npmproAuthRequest }, ...namedLocations(values.locations ?? [])].some(
		({ npmproAuthRequest: authRequest = "none" }) => authRequest !== "none",
	);
}

/**
 * The disabled controls of the TLS tab and why, for the form's values: the switches by field name, and the mTLS
 * certificate select (npmproMtlsCertificateId). The first rule that applies gives the message.
 *
 * @param   {Object}  values
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]       false for a stream (no HTTPS options, the DNS challenge always on)
 * @param   {boolean} [options.forProxyHost]  the proxy host window (mTLS bypass Auth Request)
 * @returns {Object}  field -> { id, tData? }, the message for T
 */
export function tlsDisabledReasons(values, { forHttp = true, forProxyHost = false } = {}) {
	const requested = values.certificateId === "new";
	const saved = values.certificateId > 0;
	const reasons = {};
	// mTLS works on an existing certificate only
	if (!saved) {
		const reason = requested ? REQUESTED_CERTIFICATE : NO_CERTIFICATE;
		reasons.npmproMtlsCertificateId = reason;
		reasons.npmproMtlsVerifyClientOptional = reason;
	} else if (!(values.npmproMtlsCertificateId > 0)) {
		reasons.npmproMtlsVerifyClientOptional = NO_MTLS_CERTIFICATE;
	}
	if (forProxyHost && !mtlsBypassPossible(values)) {
		reasons.npmproMtlsBypassAuthRequest = values.npmproMtlsVerifyClientOptional
			? AUTH_REQUEST
			: needs("domains.mtls-verify-client-optional");
	}
	if (forHttp) {
		if (requested || saved) {
			if (values.npmproMtlsCertificateId > 0 && !values.npmproMtlsVerifyClientOptional) {
				reasons.sslForced = MTLS_REQUIRED;
			}
			if (!values.sslForced) reasons.hstsEnabled = needs("domains.force-ssl");
			if (!values.hstsEnabled) reasons.hstsSubdomains = needs("host.flags.hsts-enabled");
		} else {
			for (const name of ["sslForced", "npmproHttp3Support", "hstsEnabled", "hstsSubdomains"]) {
				reasons[name] = NO_CERTIFICATE;
			}
		}
	}
	if (requested && !forHttp) reasons.npmproDnsChallenge = STREAM_DNS;
	return reasons;
}
