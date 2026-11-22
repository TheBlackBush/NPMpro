import { domainToASCII } from "node:url";

// Which saved DNS credential covers which names: a zone covers itself and every name below it (a.example.com and
// *.example.com are under example.com), and the longest covering zone wins. A zone on two credentials (two owners
// listed the same domain) is settled by the user's own credential, else it is a conflict, never a guess (D3).
// Pure. frontend/src/modules/DnsDomainMatch.js is its twin: both tests run test/fixtures/dns-domain-cases.json.
// A zone is { name, credentialId, ownerUserId }; callers map their rows to that form.

const TRAILING_DOT = /\.$/u;
const WILDCARD = /^(?:\*\.)+/u;

/** a name as the zones are stored: lower case, punycode, no trailing dot, a wildcard as the name it is under */
const bareName = (name) => {
	const text = String(name ?? "")
		.trim()
		.toLowerCase()
		.replace(TRAILING_DOT, "")
		.replace(WILDCARD, "");
	return text === "" ? "" : domainToASCII(text) || text;
};

const covers = (zone, host) => host === zone || host.endsWith(`.${zone}`);
const byNumber = (a, b) => a - b;
const byText = (a, b) => a.localeCompare(b);

/**
 * @param   {string}  name
 * @param   {Array<{ name: string, credentialId: number, ownerUserId: number }>}  zones
 * @param   {number}  [userId]  the signed-in user: their own credential settles a tie
 * @returns {{ zone: string, credentialIds: number[] } | null}  the longest covering zone and the credentials that
 *          hold it (one, or several when the tie is not settled)
 */
const coveringZone = (name, zones, userId) => {
	const host = bareName(name);
	if (host === "") return null;
	let best = null;
	for (const zone of zones ?? []) {
		const zoneName = bareName(zone.name);
		if (zoneName === "" || !covers(zoneName, host)) continue;
		if (best === null || zoneName.length > best.zone.length) best = { zone: zoneName, entries: [zone] };
		else if (zoneName.length === best.zone.length) best.entries.push(zone);
	}
	if (best === null) return null;
	const own = best.entries.filter((zone) => zone.ownerUserId === userId);
	const chosen = own.length > 0 ? own : best.entries;
	return { zone: best.zone, credentialIds: [...new Set(chosen.map((zone) => zone.credentialId))].sort(byNumber) };
};

/**
 * @param   {string[]}  names
 * @param   {Array}     zones
 * @param   {number}    [userId]
 * @returns {Object}    { kind: "none" } | { kind: "one", credentialId, zones } | { kind: "partial", credentialId,
 *          uncovered } | { kind: "conflict", names, credentialIds } | { kind: "spread", groups: [{ credentialId,
 *          names }] }
 */
const matchNames = (names, zones, userId) => {
	const covered = [];
	const uncovered = [];
	const conflicts = [];
	for (const name of names ?? []) {
		if (bareName(name) === "") continue;
		const cover = coveringZone(name, zones, userId);
		if (cover === null) uncovered.push(name);
		else if (cover.credentialIds.length > 1) conflicts.push({ name, cover });
		else covered.push({ name, zone: cover.zone, credentialId: cover.credentialIds[0] });
	}
	if (conflicts.length > 0) {
		return {
			kind: "conflict",
			names: conflicts.map(({ name }) => name),
			credentialIds: [...new Set(conflicts.flatMap(({ cover }) => cover.credentialIds))].sort(byNumber),
		};
	}
	if (covered.length === 0) return { kind: "none" };
	const groups = [];
	for (const entry of covered) {
		const group = groups.find((candidate) => candidate.credentialId === entry.credentialId);
		if (group) group.names.push(entry.name);
		else groups.push({ credentialId: entry.credentialId, names: [entry.name] });
	}
	if (groups.length > 1) return { kind: "spread", groups };
	const { credentialId } = groups[0];
	if (uncovered.length > 0) return { kind: "partial", credentialId, uncovered };
	return { kind: "one", credentialId, zones: [...new Set(covered.map((entry) => entry.zone))].sort(byText) };
};

/**
 * @param   {string[]}  names
 * @param   {number}    credentialId
 * @param   {Array}     zones
 * @returns {string[]}  the names no zone of that credential covers (a shorter zone of it counts too)
 */
const uncoveredBy = (names, credentialId, zones) => {
	const own = (zones ?? []).filter((zone) => zone.credentialId === credentialId).map((zone) => bareName(zone.name));
	return (names ?? []).filter((name) => {
		const host = bareName(name);
		return host !== "" && !own.some((zone) => zone !== "" && covers(zone, host));
	});
};

export { bareName, coveringZone, matchNames, uncoveredBy };
