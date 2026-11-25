import { DdnsProviderError } from "../errors.js";

// Shared parts of the ACME challenge cleanup: what counts as a challenge record, the page and item caps, and the
// answer to a delete. Each provider reads its own pages and hands plain records to collectChallenges.

const PREFIX = "_acme-challenge";
const MAX_ITEMS = 500;
const MAX_PAGES = 25;
const QUOTED_STRING = /"(?<text>(?:[^"\\]|\\.)*)"/gu;
const TRAILING_DOT = /\.$/u;

/**
 * A TXT value without the quotes a provider shows around its strings ("a" "b" are joined); an unquoted value is kept
 *
 * @param   {*} value
 * @returns {String}
 */
const unquote = (value) => {
	const text = String(value ?? "").trim();
	if (!text.startsWith('"')) return text;
	const parts = [...text.matchAll(QUOTED_STRING)].map((match) =>
		match.groups.text.replaceAll(/\\(?<char>.)/gu, "$<char>"),
	);
	return parts.length > 0 ? parts.join("") : text;
};

/** An ISO time, or null for anything that is not a time */
const isoOrNull = (value) => {
	if (typeof value !== "string" || value === "") return null;
	const time = new Date(value);
	return Number.isNaN(time.getTime()) ? null : time.toISOString();
};

/**
 * The full lower case name of a record. A relative name (Hetzner, Gandi, OVH, deSEC, DigitalOcean) is completed with
 * the zone (`@` and an empty name are the zone); a full name only loses its trailing dot.
 *
 * @param   {String}  zone
 * @param   {*}       name
 * @param   {boolean} [relative]  the provider names records relative to the zone
 * @returns {String}
 */
const fullName = (zone, name, relative = false) => {
	const z = zone.toLowerCase();
	const text = String(name ?? "")
		.trim()
		.toLowerCase()
		.replace(TRAILING_DOT, "");
	if (!relative) return text;
	return text === "" || text === "@" ? z : `${text}.${z}`;
};

/** `_acme-challenge.<zone>` or a name below it, never `_acme-txt.x` or `_acme-challenge-x` */
const isChallengeName = (full, zone) => {
	const z = `.${zone.toLowerCase()}`;
	if (!full.endsWith(z)) return false;
	const relative = full.slice(0, -z.length);
	return relative === PREFIX || relative.startsWith(`${PREFIX}.`);
};

const sameValues = (a, b) => {
	const left = [...a].sort((x, y) => x.localeCompare(y));
	const right = [...b].sort((x, y) => x.localeCompare(y));
	return left.length === right.length && left.every((value, i) => value === right[i]);
};

/**
 * Reads pages through the provider's own fetchPage and builds the challenge list.
 *
 * @param   {Object}   options
 * @param   {String}   options.zone
 * @param   {Function} options.fetchPage  (page) => Promise<{ records: Object[], more: boolean }>; a record is
 *                                        { name (full, lower case), type, id (null for a set), values, changed_on }
 * @param   {Function} [options.cnames]   () => Promise<number>: the CNAMEs at the challenge name, for providers whose
 *                                        TXT listing cannot show them
 * @returns {Promise<{ items: Object[], skipped_cnames: number, truncated: boolean }>}
 */
const collectChallenges = async ({ zone, fetchPage, cnames }) => {
	const items = [];
	let skipped = 0;
	let truncated = false;
	let page = 1;
	for (; page <= MAX_PAGES && !truncated; page++) {
		const { records, more } = await fetchPage(page);
		for (const record of records) {
			if (!isChallengeName(record.name, zone)) continue;
			if (record.type === "CNAME") {
				skipped++;
				continue;
			}
			if (record.type !== "TXT") continue;
			if (items.length >= MAX_ITEMS) {
				truncated = true;
				break;
			}
			items.push({
				key: `${record.name}|${record.id ?? "set"}`,
				name: record.name,
				id: record.id ?? null,
				values: record.values.map(unquote),
				changed_on: isoOrNull(record.changed_on),
			});
		}
		if (!more) break;
		if (page === MAX_PAGES) truncated = true;
	}
	if (cnames) skipped += await cnames();
	return { items, skipped_cnames: skipped, truncated };
};

/**
 * Settles the answer of a delete. A success is a success; a documented "already gone" answer is gone; a refusal
 * (401, 403) is never gone; any other failure is looked at again (`recheck` says whether the record is still there)
 * because a provider's gone answer may be undocumented: absent is done.
 *
 * @param   {Object}   options
 * @param   {Object}   options.res
 * @param   {Function} options.ok        (res) => boolean
 * @param   {Function} [options.gone]    (res) => boolean: the provider's documented gone answer
 * @param   {Function} [options.recheck] () => Promise<boolean>: true when the record is no longer there
 * @param   {Function} options.fail      (res) => never
 * @returns {Promise<{ gone: boolean }>}
 */
const settleDelete = async ({ res, ok, gone, recheck, fail }) => {
	if (ok(res)) return { gone: false };
	if (gone?.(res)) return { gone: true };
	if (res.status === 401 || res.status === 403) return fail(res);
	if (recheck) {
		let absent = false;
		try {
			absent = await recheck();
		} catch {
			absent = false;
		}
		if (absent) return { gone: true };
	}
	return fail(res);
};

/** A record id in the form the provider documents; anything else is refused before a call (it would become part of a path) */
const requireId = (item, valid) => {
	if (!valid(item?.id)) {
		throw new DdnsProviderError({
			code: "failed",
			message: "Not a valid record id for this provider",
			retry: false,
		});
	}
};

/** The delete of a set that is not what the list showed is not done: the caller reports it as changed */
const changedSet = () => ({ gone: false, changed: true });

/** A delete only ever touches a challenge name inside the zone; anything else is refused before a call */
const assertChallengeItem = (zone, item) => {
	if (typeof item?.name !== "string" || !isChallengeName(item.name, zone)) {
		throw new DdnsProviderError({
			code: "failed",
			message: "Not an ACME challenge record of this zone",
			retry: false,
		});
	}
};

export {
	assertChallengeItem,
	changedSet,
	collectChallenges,
	fullName,
	isChallengeName,
	isoOrNull,
	PREFIX,
	requireId,
	sameValues,
	settleDelete,
	unquote,
};
