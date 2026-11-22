import { displayDomain } from "./DnsDomainForms.js";
import { toAscii } from "./Punycode.js";

// The suggestions of a Domain Names field (D5): the DNS domains of the credentials the user sees, completed with the
// typed text, and the names hosts and certificates already use. Input help only: any valid name can still be typed.
// Pure.

const LIMIT = 8;
const WILDCARD_LEAD = /^\*(?:\.|$)/u;
const ASCII_END = 128;
const ZONES = "domain-names.group.zones";
const USED = "domain-names.group.used";

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * @param   {Object}    input
 * @param   {string}    input.query      the typed text
 * @param   {Object[]}  [input.zones]    suggestion zones ({ name, credentialName, ... })
 * @param   {Object[]}  [input.names]    suggestion names ({ name, source })
 * @param   {string[]}  [input.values]   the names the field holds
 * @param   {boolean}   [input.wildcards] whether the field takes wildcard names
 * @param   {Function}  [input.isValid]  (name) => whether the field takes it
 * @returns {Object[]}  { value, label, groupLabelId, detail }
 */
export function domainSuggestions({ query, zones, names, values, wildcards = false, isValid = () => true }) {
	const typed = String(query ?? "")
		.trim()
		.toLowerCase();
	// the stored names are ASCII: typed Unicode text is matched in its stored form
	const text = [...typed].every((char) => char.codePointAt(0) < ASCII_END) ? typed : toAscii(typed) || typed;
	if (text === "") return [];
	// "*" is only ever the leading "*." label (or a bare "*"), and only where the field takes wildcards
	if (text.includes("*") && (!wildcards || text.replace(WILDCARD_LEAD, "").includes("*"))) return [];
	const held = new Set((values ?? []).map((value) => String(value).trim().toLowerCase()));
	const offered = new Set();
	const add = (list, value, groupLabelId, detail) => {
		const key = value.toLowerCase();
		if (held.has(key) || offered.has(key) || !isValid(value)) return;
		offered.add(key);
		list.push({ value, label: displayDomain(value), groupLabelId, detail });
	};

	// one entry per zone name, with the credential that comes first by name
	const byZone = new Map();
	for (const zone of [...(zones ?? [])].sort(
		(a, b) => a.name.localeCompare(b.name) || String(a.credentialName).localeCompare(String(b.credentialName)),
	)) {
		if (!byZone.has(zone.name)) byZone.set(zone.name, zone);
	}
	const dot = text.lastIndexOf(".");
	const head = dot === -1 ? text : text.slice(0, dot);
	const tail = dot === -1 ? "" : text.slice(dot + 1);
	// typed Unicode is also matched as written against the Unicode form of the names: a partial label such as "bü"
	// has no ASCII form that is part of the stored "xn--bcher-kva.de"
	const unicode = typed !== text;
	const shown = (name) => displayDomain(name).toLowerCase();
	const typedTail = typed.slice(typed.lastIndexOf(".") + 1);
	const holds = (name) => name.toLowerCase().includes(text) || (unicode && shown(name).includes(typed));
	const startsWithText = (name) => name.toLowerCase().startsWith(text) || (unicode && shown(name).startsWith(typed));
	const zoneStarts = (zoneName) => zoneName.startsWith(tail) || (unicode && shown(zoneName).startsWith(typedTail));
	const zoneEntries = [];
	for (const [zoneName, zone] of byZone) {
		const detail = { kind: "zone", credentialName: zone.credentialName };
		if (dot === -1) {
			if (text !== "*") add(zoneEntries, `${text}.${zoneName}`, ZONES, detail);
		} else {
			if (holds(zoneName)) add(zoneEntries, zoneName, ZONES, detail);
			if (head !== "" && head !== "*" && zoneStarts(zoneName))
				add(zoneEntries, `${head}.${zoneName}`, ZONES, detail);
		}
	}
	if (wildcards) {
		for (const [zoneName, zone] of byZone) {
			const value = `*.${zoneName}`;
			// a dot-free query lists wildcards only when it starts with "*" or is part of the zone name
			const typedPart = dot === -1 && (text === "*" || holds(zoneName));
			if (typedPart || (dot !== -1 && (holds(value) || (head === "*" && zoneStarts(zoneName))))) {
				add(zoneEntries, value, ZONES, { kind: "wildcard", credentialName: zone.credentialName });
			}
		}
	}

	const used = [];
	const matching = (names ?? []).filter((entry) => holds(entry.name) && (wildcards || !entry.name.startsWith("*")));
	const starts = matching.filter((entry) => startsWithText(entry.name)).sort(byName);
	const contains = matching.filter((entry) => !startsWithText(entry.name)).sort(byName);
	for (const entry of [...starts, ...contains]) add(used, entry.name, USED, { kind: "used", source: entry.source });

	return [...zoneEntries.slice(0, LIMIT), ...used.slice(0, LIMIT)];
}
