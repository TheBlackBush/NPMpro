/**
 * The rules of the proxy host window and its custom locations on React Hook Form: the starting values (a location
 * row has every field), the validate function (built from the rules the Formik window, its LocationsFields and
 * AccessFields had) and the request a save sends. Pure, so node --test checks them without a DOM.
 */
import { fieldsValidate, mergeErrors } from "./HookForm.js";
import {
	CERTIFICATE_REQUEST_DEFAULTS,
	domainNamesOptions,
	domainNamesRule,
	forwardHostError,
	requestValues,
	tlsRules,
} from "./HostForms.js";

// the backend's rules (schema/components/proxy-host-object.json, lib/host-config-guard.js)
const PATH = /^\S{1,255}$/u;
const PORT = /^\d{1,5}$/u;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/u;
const NGINX_SYNTAX = /[$;{}"'\\#]/u;

/**
 * The backend's rule for a non-admin "path" target (lib/host-config-guard.js): an absolute path inside /var/www,
 * no ..
 *
 * @param   {*} value
 * @returns {boolean}
 */
export const insideWebroot = (value) =>
	typeof value === "string" &&
	(value === "/var/www" || value.startsWith("/var/www/")) &&
	!value.split("/").includes("..") &&
	PRINTABLE_ASCII.test(value) &&
	!NGINX_SYNTAX.test(value);

/**
 * A port as the text field shows it: 0 (no port) is empty
 *
 * @param   {*} port
 * @returns {string}
 */
const portText = (port) => (port ? String(port) : "");

/**
 * A custom location row with every field (a new row, or a saved one completed with the defaults)
 *
 * @param   {Object} [location]
 * @returns {Object}
 */
export const newLocation = (location = {}) => ({
	npmproEnabled: true,
	path: "",
	locationType: "",
	advancedConfig: "",
	forwardScheme: "http",
	forwardHost: "",
	forwardPort: "",
	npmproAccessListIds: [],
	npmproNoindex: false,
	npmproCrowdsecAppsec: false,
	npmproProxyResponseBuffering: false,
	npmproProxyRequestBuffering: false,
	npmproUpstreamCompression: false,
	npmproFancyindex: false,
	npmproXFrameOptions: "SAMEORIGIN",
	npmproAuthRequest: "none",
	npmproAuthRequestUpstream: "",
	npmproAccessListType: "global",
	...location,
});

/**
 * The rows with a path (the Formik value left out the others): the "*" of the Custom locations tab and the
 * locations the mTLS options look at
 *
 * @param   {Object[]} rows
 * @returns {Object[]}
 */
export const namedLocations = (rows) => rows.filter((row) => String(row.path ?? "").trim() !== "");

/**
 * Whether a forward scheme change checks the proxy host's forward host again: "empty" needs no host, so its message
 * goes; coming back from "empty" the host stays quiet until it is left or Save is clicked (as the Formik window,
 * whose check after a scheme change still saw "empty"); between schemes that need a host its message follows.
 *
 * @param   {string}  previous  the scheme before the change
 * @param   {string}  scheme    the chosen scheme
 * @returns {boolean}
 */
export const hostRecheckOnScheme = (previous, scheme) => scheme === "empty" || previous !== "empty";

/**
 * The errors of the location rows (blank ones included), one object per row in the same order, or undefined
 *
 * @param   {Object}   rules  createValidations(intl)
 * @param   {Object[]} rows
 * @returns {Object[]|undefined}
 */
export function locationErrors(rules, rows) {
	const seen = new Set();
	const errors = rows.map((row) => {
		const error = {};
		const path = String(row.path ?? "").trim();
		if (path === "") error.path = rules.message("error.required");
		else if (!PATH.test(path)) error.path = rules.message("location.path.invalid");
		else {
			const key = `${row.locationType}${path}`;
			if (seen.has(key)) error.path = rules.message("location.path.duplicate");
			seen.add(key);
		}
		const host = forwardHostError(rules, row.forwardHost, { proxy: true, scheme: row.forwardScheme });
		if (host) error.forwardHost = host;
		const port = String(row.forwardPort ?? "").trim();
		if (port !== "" && port !== "0" && !(PORT.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
			error.forwardPort = rules.message("error.number-range", { min: 1, max: 65535 });
		}
		if (row.npmproAuthRequest !== "none" && row.npmproAuthRequestUpstream) {
			const upstream = rules.validateUpstreamUrl()(row.npmproAuthRequestUpstream);
			if (upstream) error.npmproAuthRequestUpstream = upstream;
		}
		if (row.npmproAccessListType === "custom" && !(row.npmproAccessListIds?.length > 0)) {
			error.npmproAccessListIds = rules.message("error.required");
		}
		return Object.keys(error).length > 0 ? error : undefined;
	});
	return errors.some(Boolean) ? errors : undefined;
}

/**
 * The starting values of a proxy host in the window's order. A clone by a non-admin starts without the raw nginx
 * config (admin-only) and without a "path" target outside /var/www (the backend refuses it from a non-admin).
 *
 * @param   {Object}  data
 * @param   {Object}  [options]
 * @param   {boolean} [options.isClone]
 * @param   {boolean} [options.isAdmin]
 * @returns {Object}
 */
export function proxyHostDefaults(data, { isClone = false, isAdmin = false } = {}) {
	const dropConfig = isClone && !isAdmin;
	const clonedPath = (scheme, host) => (dropConfig && scheme === "path" && !insideWebroot(host) ? "" : host);
	return {
		domainNames: data.domainNames,
		forwardScheme: data.forwardScheme,
		forwardHost: clonedPath(data.forwardScheme, data.forwardHost),
		forwardPort: portText(data.forwardPort),
		npmproNoindex: data.npmproNoindex,
		npmproCrowdsecAppsec: data.npmproCrowdsecAppsec,
		npmproProxyRequestBuffering: data.npmproProxyRequestBuffering,
		npmproProxyResponseBuffering: data.npmproProxyResponseBuffering,
		npmproUpstreamCompression: data.npmproUpstreamCompression,
		npmproFancyindex: data.npmproFancyindex,
		npmproXFrameOptions: data.npmproXFrameOptions,
		npmproAuthRequest: data.npmproAuthRequest,
		npmproAuthRequestUpstream: data.npmproAuthRequestUpstream,
		npmproAccessListType: data.npmproAccessListType,
		npmproAccessListIds: data.accessLists.map((accessList) => accessList.id),
		npmproLocationConfig: dropConfig ? "" : data.npmproLocationConfig,
		locations: data.locations.map(({ id: locationId, proxyHostId, accessLists, ...location }) =>
			newLocation({
				...location,
				...(dropConfig ? { advancedConfig: "" } : {}),
				forwardHost: clonedPath(location.forwardScheme, location.forwardHost),
				forwardPort: portText(location.forwardPort),
				npmproAccessListIds: accessLists.map((accessList) => accessList.id),
			}),
		),
		certificateId: data.certificateId,
		npmproMtlsCertificateId: data.npmproMtlsCertificateId,
		npmproMtlsVerifyClientOptional: data.npmproMtlsVerifyClientOptional,
		npmproMtlsBypassAuthRequest: data.npmproMtlsBypassAuthRequest,
		sslForced: data.sslForced,
		npmproHttp3Support: data.npmproHttp3Support,
		hstsEnabled: data.hstsEnabled,
		hstsSubdomains: data.hstsSubdomains,
		...CERTIFICATE_REQUEST_DEFAULTS,
		advancedConfig: dropConfig ? "" : data.advancedConfig,
		npmproDirectory: data.npmproDirectory,
	};
}

/**
 * Proxy host: the domain names, the forward host (required unless the scheme is "empty", the backend's rule), the
 * port (1 to 65535 or empty), the auth upstream while an auth request is chosen, the custom access lists, every
 * location row, the TLS tab
 */
export const proxyHostValidate = (rules) =>
	fieldsValidate(
		(values) => ({
			domainNames: domainNamesRule(rules, domainNamesOptions(values)),
			forwardPort: rules.validateInteger({ min: 1, max: 65535 }),
			...(values.npmproAuthRequest === "none" ? {} : { npmproAuthRequestUpstream: rules.validateUpstreamUrl() }),
			...tlsRules(rules, values),
		}),
		(values) => {
			const errors = {};
			const host = forwardHostError(rules, values.forwardHost, { proxy: true, scheme: values.forwardScheme });
			if (host) errors.forwardHost = host;
			if (values.npmproAccessListType === "custom" && !(values.npmproAccessListIds?.length > 0)) {
				errors.npmproAccessListIds = rules.message("error.required");
			}
			const rows = locationErrors(rules, values.locations);
			return rows ? mergeErrors(errors, { locations: rows }) : errors;
		},
	);

/**
 * The request of a proxy host: no access lists when public, ports as numbers (0 for none), the request fields only
 * for a requested certificate
 *
 * @param   {Object} values
 * @returns {Object}
 */
export const proxyHostPayload = (values) => ({
	...requestValues(values),
	npmproAccessListIds: values.npmproAccessListType === "public" ? [] : values.npmproAccessListIds,
	forwardPort: Number(values.forwardPort) || 0,
	locations: values.locations.map((location) => ({ ...location, forwardPort: Number(location.forwardPort) || 0 })),
});
