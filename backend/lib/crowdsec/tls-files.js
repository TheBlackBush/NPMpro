import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { rooted } from "../paths.js";

// The TLS client files of the bouncer: it parses them when nginx starts or reloads (init_by_lua), which nginx -t does
// not do, and a file it cannot parse stops nginx. The same rule as launch.sh (openssl x509 and openssl pkey with
// -inform PEM): the certificate must be a PEM certificate, the key an unencrypted PEM private key.

export const TLS_FILE_KEYS = ["tls_client_cert", "tls_client_key"];
const CERT_PEM = /-----BEGIN (?:TRUSTED )?CERTIFICATE-----/u;

/**
 * @param   {"tls_client_cert"|"tls_client_key"} key
 * @param   {Buffer} content
 * @returns {boolean}
 */
export const tlsContentParses = (key, content) => {
	try {
		if (key === "tls_client_key") return Boolean(createPrivateKey({ key: content, format: "pem", passphrase: "" }));
		// X509Certificate also takes DER, the bouncer only PEM
		return CERT_PEM.test(content.toString("latin1")) && new X509Certificate(content).raw.length > 0;
	} catch {
		return false;
	}
};

/**
 * @param   {"tls_client_cert"|"tls_client_key"} key
 * @param   {string} file  container path
 * @returns {boolean}  readable and parses
 */
export const tlsFileParses = (key, file) => {
	try {
		return tlsContentParses(key, readFileSync(rooted(file)));
	} catch {
		return false;
	}
};

/**
 * The files the bouncer cannot start without that are not set, missing, unreadable or do not parse: with any of them
 * the include must leave the bouncer off. crowdsec.conf itself is not checked here: the backend writes it with the
 * include.
 *
 * @param   {Object}   values  effective values
 * @param   {Object}   [deps]
 * @param   {Function} [deps.parses]  (key, file) => boolean
 * @returns {string[]}  the paths, the setting name for one that is not set
 */
export const unusableStartFiles = (values, { parses = tlsFileParses } = {}) => {
	if (!values.enabled || !values.use_tls_auth) return [];
	return TLS_FILE_KEYS.filter((key) => values[key] === "" || !parses(key, values[key])).map(
		(key) => values[key] || key.toUpperCase(),
	);
};
