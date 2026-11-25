/**
 * The rules of the proxy host window and its custom locations on React Hook Form: the starting values (a location
 * row has every field), the validate function and the request a save sends. Pure, so node --test checks them without
 * a DOM.
 */
import { fieldsValidate, mergeErrors } from "./HookForm.js";
import {
	advancedTab,
	CERTIFICATE_REQUEST_DEFAULTS,
	domainNamesOptions,
	domainNamesRule,
	forwardHostError,
	requestValues,
	TLS_TAB_FIELDS,
	tlsRules,
} from "./HostForms.js";
import { tagsError } from "./HostTags.js";
import { htmlName, PLACE_FIELDS, placeDefaults, placeErrors, placePayload } from "./LandingPageForms.js";
import { hasOwnUpstream } from "./ProxyOptions.js";

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
	npmproAuthRequest: "global",
	npmproAuthRequestUpstream: "",
	npmproAccessListType: "global",
	...location,
});

/**
 * Whether a location shows the notice that it is public on a protected host: the host uses forward authentication and
 * the location is set to none on purpose
 *
 * @param   {string}  hostValue  the host's Auth Request
 * @param   {Object}  row
 * @returns {boolean}
 */
export const locationAuthNotice = (hostValue, row) =>
	(hostValue ?? "none") !== "none" && row.npmproAuthRequest === "none";

// the path certbot's HTTP challenge answers under (backend lib/acme-challenge.js)
const ACME_CHALLENGE_PATH = "/.well-known/acme-challenge/";

// one pair of matching outer quotes removed, as the backend does with a stored path (lib/nginx-quote.js unquote)
const unquotePath = (text) =>
	text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0] ? text.slice(1, -1) : text;

/**
 * Whether a location row replaces NPMpro's own ACME challenge location (backend lib/acme-challenge.js
 * overridesAcmeChallenge): enabled, type plain prefix or ^~, exactly /.well-known/acme-challenge/. The form value is
 * trimmed here because the save trims the path before the backend sees it.
 *
 * @param   {Object}  row
 * @returns {boolean}
 */
export const replacesAcmeChallenge = (row) =>
	row.npmproEnabled !== false &&
	["", "^~ "].includes(row.locationType ?? "") &&
	unquotePath(String(row.path ?? "").trim()) === ACME_CHALLENGE_PATH;

/**
 * Whether a location row shows the note that NPMpro can no longer validate the host's certificate over the HTTP
 * challenge: the row replaces the ACME location and the host's certificate is a requested one without the DNS
 * challenge, or an existing Let's Encrypt one without it. Unknown certificates (not in the list) show nothing.
 *
 * @param   {Object}   row
 * @param   {Object}   tls
 * @param   {*}        tls.certificateId       0, "new" or a certificate id
 * @param   {boolean}  tls.npmproDnsChallenge  the DNS challenge of a requested certificate
 * @param   {Object[]} [certificates]          useCertificates() rows
 * @returns {boolean}
 */
export function acmeRenewalNotice(row, { certificateId, npmproDnsChallenge }, certificates = []) {
	if (!replacesAcmeChallenge(row)) return false;
	if (certificateId === "new") return !npmproDnsChallenge;
	if (!(certificateId > 0)) return false;
	const certificate = certificates.find((item) => item.id === certificateId);
	return certificate?.provider === "letsencrypt" && !certificate.npmproDnsChallenge;
}

/**
 * The rows with a path: the "*" of the Custom locations tab and the locations the mTLS options look at
 *
 * @param   {Object[]} rows
 * @returns {Object[]}
 */
export const namedLocations = (rows) => rows.filter((row) => String(row.path ?? "").trim() !== "");

/**
 * Whether a forward scheme change checks the proxy host's forward host again: "empty" needs no host, so its message
 * goes; coming back from "empty" the host stays quiet until it is left or Save is clicked; between schemes that
 * need a host its message follows.
 *
 * @param   {string}  previous  the scheme before the change
 * @param   {string}  scheme    the chosen scheme
 * @returns {boolean}
 */
export const hostRecheckOnScheme = (previous, scheme) => scheme === "empty" || previous !== "empty";

/**
 * The backend's alias rule (lib/host-config-guard.js): a prefix location that serves a folder (a "path" target ending
 * in /) must itself end in /, unless it is the saved location (same type and path) with the same folder
 *
 * @param   {Object}   row
 * @param   {Object[]} [savedRows]  the saved locations
 * @returns {boolean}  true when the row breaks the rule
 */
export const aliasPrefixError = (row, savedRows = []) => {
	const folder = String(row.forwardHost ?? "");
	if (row.forwardScheme !== "path" || !folder.endsWith("/")) return false;
	if (!["", "^~ "].includes(row.locationType ?? "")) return false;
	const path = String(row.path ?? "").trim();
	if (path.endsWith("/")) return false;
	return !savedRows.some(
		(saved) =>
			(saved.locationType ?? "") === (row.locationType ?? "") &&
			saved.path === path &&
			saved.forwardScheme === "path" &&
			saved.forwardHost === row.forwardHost,
	);
};

/**
 * The errors of the location rows (blank ones included), one object per row in the same order, or undefined
 *
 * @param   {Object}   rules  createValidations(intl)
 * @param   {Object[]} rows
 * @param   {Object[]} [savedRows]  the saved locations (the alias rule keeps a saved one)
 * @returns {Object[]|undefined}
 */
export function locationErrors(rules, rows, savedRows = []) {
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
			if (!error.path && aliasPrefixError(row, savedRows)) {
				error.path = rules.message("error.path-scheme-alias-prefix");
			}
		}
		const host = forwardHostError(rules, row.forwardHost, { proxy: true, scheme: row.forwardScheme });
		if (host) error.forwardHost = host;
		const port = String(row.forwardPort ?? "").trim();
		if (port !== "" && port !== "0" && !(PORT.test(port) && Number(port) >= 1 && Number(port) <= 65535)) {
			error.forwardPort = rules.message("error.number-range", { min: 1, max: 65535 });
		}
		if (hasOwnUpstream(row.npmproAuthRequest) && row.npmproAuthRequestUpstream) {
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
 * The starting values of a proxy host in the window's order. A clone starts without domain names (the backend refuses
 * a domain name an enabled host already uses); a clone by a non-admin also without the raw nginx config (admin-only)
 * and without a "path" target outside /var/www (the backend refuses it from a non-admin).
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
		domainNames: isClone ? [] : data.domainNames,
		npmproDescription: data.npmproDescription ?? "",
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
		npmproTags: data.npmproTags ?? [],
		npmproMaintenance: data.npmproMaintenance ?? false,
		...placeDefaults("proxyHost", data),
	};
}

/**
 * The tabs of the proxy host window (ModalTabs)
 */
export const PROXY_HOST_TABS = Object.freeze([
	{
		id: "details",
		labelId: "column.details",
		fields: [
			"domainNames",
			"npmproDescription",
			"forwardScheme",
			"forwardHost",
			"forwardPort",
			"npmproDirectory",
			"npmproTags",
			"npmproNoindex",
			"npmproCrowdsecAppsec",
			"npmproProxyRequestBuffering",
			"npmproProxyResponseBuffering",
			"npmproUpstreamCompression",
			"npmproFancyindex",
			"npmproXFrameOptions",
			"npmproAuthRequest",
			"npmproAuthRequestUpstream",
			"npmproAccessListType",
			"npmproAccessListIds",
			// the host record option's boxes (its DNS card is under the names; the field has no input of its own)
			"npmproDnsRecords",
		],
	},
	{ id: "locations", labelId: "column.custom-locations", fields: ["locations"] },
	{ id: "tls", labelId: "column.ssl", fields: TLS_TAB_FIELDS },
	{
		id: "pages",
		labelId: "landing-pages.tab",
		fields: ["npmproMaintenance", ...PLACE_FIELDS.proxyHost.flatMap(({ name }) => [name, htmlName(name)])],
	},
	advancedTab("advancedConfig", "npmproLocationConfig"),
]);

/**
 * Proxy host: the domain names, the forward host (required unless the scheme is "empty", the backend's rule), the
 * port (1 to 65535 or empty), the auth upstream while an auth request is chosen, the custom access lists, every
 * location row (the alias rule keeps a saved location), the TLS tab
 */
export const proxyHostValidate = (rules, { savedLocations = [] } = {}) =>
	fieldsValidate(
		(values) => ({
			domainNames: domainNamesRule(rules, domainNamesOptions(values)),
			npmproDescription: rules.validateString(0, 255),
			npmproTags: (value) => tagsError(rules, value),
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
			Object.assign(errors, placeErrors(rules, "proxyHost", values));
			const rows = locationErrors(rules, values.locations, savedLocations);
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
	...placePayload("proxyHost", requestValues(values)),
	npmproAccessListIds: values.npmproAccessListType === "public" ? [] : values.npmproAccessListIds,
	forwardPort: Number(values.forwardPort) || 0,
	locations: values.locations.map((location) => ({ ...location, forwardPort: Number(location.forwardPort) || 0 })),
});
