import { createHash } from "node:crypto";
import { DdnsProviderError } from "../errors.js";
import { collectZones, failAnswer, malformed } from "./zone-common.js";

// OVH signs every request: "$1$" + sha1(secret + "+" + consumer + "+" + method + "+" + url + "+" + body + "+" +
// timestamp), the timestamp being the server's (GET /auth/time), as python-ovh and ovh.js do.

const ENDPOINTS = Object.freeze({
	"ovh-eu": "https://eu.api.ovh.com/1.0",
	"ovh-ca": "https://ca.api.ovh.com/1.0",
	"ovh-us": "https://api.us.ovhcloud.com/1.0",
	"kimsufi-eu": "https://eu.api.kimsufi.com/1.0",
	"kimsufi-ca": "https://ca.api.kimsufi.com/1.0",
	"soyoustart-eu": "https://eu.api.soyoustart.com/1.0",
	"soyoustart-ca": "https://ca.api.soyoustart.com/1.0",
});

/**
 * @param   {*} value  the endpoint name of the credential
 * @returns {String|null}  the base URL, or null for an unknown name
 */
const ovhEndpoint = (value) => (typeof value === "string" && Object.hasOwn(ENDPOINTS, value) ? ENDPOINTS[value] : null);

const ovhSignature = ({ secret, consumer, method, url, body, timestamp }) =>
	`$1$${createHash("sha1").update(`${secret}+${consumer}+${method}+${url}+${body}+${timestamp}`).digest("hex")}`;

const secretsOf = (fields) => [fields.dns_ovh_application_secret, fields.dns_ovh_consumer_key];

/**
 * One signed OVH call. Reads the server time once per call so a skewed clock still signs right. Never throws for
 * a 4xx or 5xx (the caller decides), throws DdnsProviderError for a network failure or an unknown endpoint.
 *
 * @param   {Object}   options
 * @param   {Object}   options.fields   the credential values
 * @param   {Function} options.fetch    providerFetch bound to the secrets
 * @param   {String}   [options.method]
 * @param   {String}   options.path     starting with "/"
 * @param   {*}        [options.body]   serialized to JSON when given
 * @returns {Promise<{status: number, headers: Headers, text: String, json: *}>}
 */
const ovhRequest = async ({ fields, fetch, method = "GET", path, body }) => {
	const secrets = secretsOf(fields);
	const base = ovhEndpoint(fields.dns_ovh_endpoint);
	if (base === null) throw new DdnsProviderError({ code: "failed", message: "Unknown OVH endpoint", retry: false });
	const time = await fetch(`${base}/auth/time`, { headers: { Accept: "application/json" } });
	const timestamp = Number.isInteger(time.json) ? time.json : Number.parseInt(time.text, 10);
	if (time.status !== 200 || !Number.isInteger(timestamp)) failAnswer(time, { hint: "", secrets });
	const url = `${base}${path}`;
	const payload = body === undefined ? "" : JSON.stringify(body);
	return fetch(url, {
		method,
		body: payload === "" ? undefined : payload,
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"X-Ovh-Application": fields.dns_ovh_application_key,
			"X-Ovh-Consumer": fields.dns_ovh_consumer_key,
			"X-Ovh-Timestamp": String(timestamp),
			"X-Ovh-Signature": ovhSignature({
				secret: fields.dns_ovh_application_secret,
				consumer: fields.dns_ovh_consumer_key,
				method,
				url,
				body: payload,
				timestamp,
			}),
		},
	});
};

export { ovhEndpoint, ovhRequest, ovhSignature };

export default {
	id: "ovh",
	label: "OVH",
	credentialProvider: "ovh",
	listZones: ({ fields, fetch }) =>
		collectZones({
			fetchPage: async () => {
				const secrets = secretsOf(fields);
				const res = await ovhRequest({ fields, fetch, path: "/domain/zone" });
				if (res.status !== 200) failAnswer(res, { hint: "A right on GET /domain/zone", secrets });
				if (!Array.isArray(res.json)) throw malformed(res, secrets);
				return { names: res.json, more: false };
			},
		}),
};
