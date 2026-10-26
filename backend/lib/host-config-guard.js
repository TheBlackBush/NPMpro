import path from "node:path";
import errs from "./error.js";

/**
 * Raw nginx config and file serving are admin-only. Every host field below is rendered verbatim into an nginx
 * template, so whoever sets it controls nginx (which runs as root). Non-admins may keep a value an admin set, but not
 * set or change one. The "path" forward scheme turns forward_host into `root`/`alias`, so non-admins may only serve
 * files from below WEBROOT.
 */

const WEBROOT = "/var/www";

const CONFIG_FIELDS = {
	proxy_host: ["advanced_config", "npmpro_location_config"],
	redirection_host: ["advanced_config"],
	dead_host: ["advanced_config"],
	stream: ["npmpro_advanced_config"],
};

const advancedConfigError = () =>
	new errs.PermissionError(
		"Only administrators can change the advanced nginx configuration.",
		"error.advanced-config-admin-only",
	);

const pathSchemeError = () =>
	new errs.ValidationError(
		`Only administrators can serve files from outside ${WEBROOT}. Use an absolute path inside ${WEBROOT}.`,
		"error.path-scheme-webroot",
	);

const aliasPrefixError = () =>
	new errs.ValidationError(
		"A custom location that serves a folder (a path ending in /) must itself end in /.",
		"error.path-scheme-alias-prefix",
	);

// anything but printable ASCII (whitespace, control and non-ASCII characters) and what nginx treats specially
const UNSAFE_PATH_CHARS = /[^\x21-\x7e]|[$;{}"'\\#]/u;

const asText = (value) => (typeof value === "string" ? value : "");
const isBlank = (value) => asText(value).trim() === "";

/**
 * Blank values (empty, only whitespace, null or missing) count as the same value, anything else must match exactly.
 *
 * @param   {*} value
 * @param   {*} stored
 * @returns {Boolean}
 */
const sameConfig = (value, stored) =>
	isBlank(value) ? isBlank(stored) : !isBlank(stored) && asText(value) === asText(stored);

/**
 * True when value is an absolute path that stays inside WEBROOT: no `..` segment, no characters nginx would treat
 * specially in an unquoted `root`/`alias` argument (variables, quotes, escapes, `;`, braces, comments) and no
 * whitespace or control characters.
 *
 * @param   {*}  value
 * @returns {Boolean}
 */
const isInsideWebroot = (value) => {
	if (typeof value !== "string" || !value.startsWith("/")) return false;
	if (UNSAFE_PATH_CHARS.test(value)) return false;
	if (value.split("/").includes("..")) return false;
	const normalized = path.posix.normalize(value);
	return normalized === WEBROOT || normalized.startsWith(`${WEBROOT}/`);
};

/**
 * @param {Boolean}  isAdmin
 * @param {Object}   data      the create or update payload
 * @param {Object}   [stored]  the stored row on update
 * @param {String[]} fields    the free-form config fields of the host type
 */
const assertConfigFields = (isAdmin, data, stored, fields) => {
	if (isAdmin) return;
	for (const field of fields) {
		if (data[field] !== undefined && !sameConfig(data[field], stored?.[field])) throw advancedConfigError();
	}
};

/**
 * A non-admin may set the "path" scheme only to a path inside WEBROOT, unless the scheme and path are the stored ones.
 *
 * @param {Boolean} isAdmin
 * @param {Object}  item      host or location payload
 * @param {Object}  [stored]  the stored host or location
 */
const assertPathScheme = (isAdmin, item, stored) => {
	if (isAdmin) return;
	const scheme = item.forward_scheme ?? stored?.forward_scheme;
	if (scheme !== "path") return;
	const host = item.forward_host ?? stored?.forward_host;
	if (stored?.forward_scheme === "path" && stored.forward_host === host) return;
	if (!isInsideWebroot(host)) throw pathSchemeError();
};

/**
 * A custom prefix location renders a folder path (ending in `/`) as `alias`. nginx then replaces the location path
 * with the folder, so a location path without the trailing slash (`/x` with `/var/www/a/`) lets `/x../` reach the
 * parent folder. Non-admins must end such a location path in `/`, unless the location is the stored one.
 *
 * @param {Object} location  location payload
 * @param {Object} [stored]  the matching stored location
 */
const assertAliasPrefix = (location, stored) => {
	const scheme = location.forward_scheme ?? stored?.forward_scheme;
	const host = location.forward_host ?? stored?.forward_host;
	if (scheme !== "path" || typeof host !== "string" || !host.endsWith("/")) return;
	if (!["", "^~ "].includes(location.location_type ?? "")) return;
	if (String(location.path ?? "").endsWith("/")) return;
	if (stored?.forward_scheme === "path" && stored.forward_host === host) return;
	throw aliasPrefixError();
};

const locationKey = (location) => `${location.location_type ?? ""}\u0000${location.path ?? ""}`;

/**
 * Applies both rules to custom locations. A location matches a stored one with the same type and path. A non-admin
 * payload without `advanced_config` keeps the stored value of the matching location.
 *
 * @param {Boolean}  isAdmin
 * @param {Object[]} [locations]        payload locations (changed in place)
 * @param {Object[]} [storedLocations]
 */
const assertLocations = (isAdmin, locations, storedLocations = []) => {
	if (isAdmin || !Array.isArray(locations)) return;
	const stored = new Map((storedLocations ?? []).map((location) => [locationKey(location), location]));
	for (const payload of locations) {
		// a saved location without a scheme gets the column default, so the checks use it too
		const location = { ...payload, forward_scheme: payload.forward_scheme ?? "http" };
		const match = stored.get(locationKey(location));
		if (payload.advanced_config === undefined) {
			payload.advanced_config = match?.advanced_config ?? "";
		} else if (!sameConfig(location.advanced_config, match?.advanced_config)) {
			throw advancedConfigError();
		}
		assertPathScheme(false, location, match);
		assertAliasPrefix(location, match);
	}
};

/**
 * Two custom locations with the same type and path: nginx would reject the config, so refused for everyone
 *
 * @param {Object[]} [locations]
 */
const assertUniqueLocations = (locations) => {
	if (!Array.isArray(locations)) return;
	const seen = new Set();
	for (const location of locations) {
		const key = locationKey(location);
		if (seen.has(key)) {
			throw new errs.ValidationError(`Two custom locations have the same path: ${location.path}`);
		}
		seen.add(key);
	}
};

/**
 * All checks for one host create or update.
 *
 * @param {Object}  access
 * @param {String}  hostType  key of CONFIG_FIELDS
 * @param {Object}  data
 * @param {Object}  [stored]
 */
const assertHostConfig = (access, hostType, data, stored) => {
	const isAdmin = access.isAdmin === true;
	assertConfigFields(isAdmin, data, stored, CONFIG_FIELDS[hostType]);
	if (hostType === "proxy_host") {
		assertUniqueLocations(data.locations);
		assertPathScheme(isAdmin, data, stored);
		assertLocations(isAdmin, data.locations, stored?.locations);
	}
};

export {
	assertAliasPrefix,
	assertConfigFields,
	assertHostConfig,
	assertLocations,
	assertPathScheme,
	assertUniqueLocations,
	CONFIG_FIELDS,
	isInsideWebroot,
	sameConfig,
	WEBROOT,
};
