import { domainToASCII } from "node:url";
import { readAcmeDirectory } from "../acme-directory.js";
import { caaFallbackOf, isTrustedServer } from "../acme-server.js";
import { getRuntimeConfig } from "../runtime-config.js";
import { evaluateCaa } from "./caa.js";

// The CAA check of names: the climb of RFC 8659 section 3 (find the Relevant RRset) and the evaluation of each name.
// The lookups are passed in, so the climb itself touches no network.

const MAX_LEVELS = 10;
const LEADING_WILDCARD = /^\*\./u;
const NOT_FOUND = new Set(["nodata", "nxdomain"]);
const HOSTNAME = /^(?:\*\.)?[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*$/u;

/**
 * The CAA set that applies to a name: the first non-empty set at the name or a parent, at most 10 levels, up to and
 * including the top level label. A wildcard `*.x` starts at `x`. NODATA and NXDOMAIN move up; any other failure
 * stops the climb.
 *
 * @param   {String}    name
 * @param   {Function}  lookup  (name, "CAA") -> { ok, values } | { ok: false, code }
 * @returns {Promise<{ ok: true, at: String|null, records: Array } | { ok: false, code: String }>}  at: where the set
 *          was found, null when there is none anywhere
 */
const findCaaSet = async (name, lookup) => {
	let current = String(name).replace(LEADING_WILDCARD, "");
	for (let level = 0; level < MAX_LEVELS; level += 1) {
		const found = await lookup(current, "CAA");
		if (found.ok && found.values.length > 0) return { ok: true, at: current, records: found.values };
		if (!found.ok && !NOT_FOUND.has(found.code)) return { ok: false, code: found.code };
		const dot = current.indexOf(".");
		if (dot < 0) break;
		current = current.slice(dot + 1);
	}
	return { ok: true, at: null, records: [] };
};

const result = (name, state, extra = {}) => ({
	name,
	state,
	reason: null,
	found_at: null,
	record: null,
	error_i18n: null,
	...extra,
});

/**
 * @param   {Object}    options
 * @param   {String[]}  options.names
 * @param   {String[]}  options.identities
 * @param   {String}    options.method
 * @param   {boolean}   options.parameters  evaluate validationmethods and accounturi (Let's Encrypt only)
 * @param   {Function}  options.lookup
 * @returns {Promise<Array>}  one { name, state, reason, found_at, record, error_i18n } per name, in order
 */
const checkCaaNames = async ({ names, identities, method, parameters, lookup }) => {
	// names of one call share their climbs (a name and its siblings meet at the parent)
	const climbs = new Map();
	const cached = (name, type) => {
		const key = `${name}|${type}`;
		if (!climbs.has(key)) climbs.set(key, lookup(name, type));
		return climbs.get(key);
	};
	return await Promise.all(
		names.map(async (name) => {
			const ascii = domainToASCII(String(name)).toLowerCase() || String(name).toLowerCase();
			if (!HOSTNAME.test(ascii)) return result(name, "not-checked", { reason: "skipped-pattern" });
			const set = await findCaaSet(ascii, cached);
			if (!set.ok) return result(name, "unknown", { reason: `lookup-${set.code}` });
			const verdict = evaluateCaa({ name: ascii, records: set.records, identities, method, parameters });
			return result(name, verdict.state, { reason: verdict.reason, found_at: set.at, record: verdict.record });
		}),
	);
};

/**
 * The CAA identities of a CA: the directory's meta.caaIdentities, else the fixed list of a preset, else none
 *
 * @param   {String}  server  the CA's directory URL
 * @returns {Promise<String[]|null>}
 */
const caaIdentitiesOf = async (server) => {
	let fromDirectory = [];
	try {
		const verify = (await getRuntimeConfig("certificates")).values.server_tls_verify !== false;
		const directory = await readAcmeDirectory(server, {
			verify,
			guarded: !isTrustedServer(server, process.env),
		});
		fromDirectory = directory.caa_identities ?? [];
	} catch {
		fromDirectory = [];
	}
	if (fromDirectory.length > 0) return fromDirectory;
	return caaFallbackOf(server);
};

export { caaIdentitiesOf, checkCaaNames, findCaaSet };
