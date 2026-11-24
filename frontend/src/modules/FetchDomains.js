// The zone section of the Add domains window: what an answer of GET /nginx/dns-credentials/{id}/provider-domains (or its
// error) shows, which zones start ticked and the body of the save. Pure.

import { displayDomain } from "./DnsDomainForms.js";

const HINTED = new Set(["bunny", "cloudflare", "desec", "digitalocean", "linode", "ovh", "porkbun", "vultr"]);
// the only error the permission hint is for: the provider refused the credential
const FORBIDDEN = "error.dns-zones-forbidden";

/**
 * @param   {string|undefined} provider  the provider id of the credential
 * @returns {string}  the translation id of the hint shown under an error
 */
export function hintIdOf(provider) {
	return `dns-domains.fetch.hint.${HINTED.has(provider) ? provider : "other"}`;
}

/**
 * @param   {{ supported: boolean, truncated: boolean,
 *            zones: { name: string, state: string, credentialName?: string }[] }|undefined} answer
 * @param   {unknown} error     the error of the request, if it failed
 * @param   {string} [provider] the provider id of the credential, for the hint
 * @returns {{ kind: "loading"|"list"|"empty"|"error"|"not-supported", rows: object[], hintId: string|null,
 *            truncated: boolean }}  hintId only for a refused credential (error.dns-zones-forbidden)
 */
export function fetchState(answer, error, provider) {
	if (answer && !answer.supported) {
		return { kind: "not-supported", rows: [], hintId: null, truncated: false };
	}
	if (error) {
		const forbidden = error?.payload?.error?.message_i18n === FORBIDDEN;
		return { kind: "error", rows: [], hintId: forbidden ? hintIdOf(provider) : null, truncated: false };
	}
	if (!answer) {
		return { kind: "loading", rows: [], hintId: null, truncated: false };
	}
	const rows = [...answer.zones].sort((a, b) => displayDomain(a.name).localeCompare(displayDomain(b.name)));
	return { kind: rows.length ? "list" : "empty", rows, hintId: null, truncated: Boolean(answer.truncated) };
}

// the most names one save takes, typed and ticked together (the API's limit)
export const MAX_NAMES = 100;

const byDisplay = (a, b) => displayDomain(a.name).localeCompare(displayDomain(b.name));

/**
 * @param   {{ name: string, state: string }[]|undefined} zones
 * @param   {number} room  how many more names one save takes (MAX_NAMES minus the typed names)
 * @returns {Set<string>}  the first new zones in display order, at most room of them
 */
export function autoSelection(zones, room = MAX_NAMES) {
	const fresh = (zones ?? []).filter((zone) => zone.state === "new").sort(byDisplay);
	return new Set(fresh.slice(0, Math.max(0, room)).map((zone) => zone.name));
}

/**
 * @param   {number} typedCount   typed names
 * @param   {number} tickedCount  ticked zones
 * @param   {number} newCount     new zones the provider lists
 * @returns {{ full: boolean, over: boolean, more: boolean }}  full: no more zone can be ticked; over: a save is
 *          refused; more: the provider has more new zones than one save can take
 */
export function limitState(typedCount, tickedCount, newCount) {
	const total = typedCount + tickedCount;
	return {
		full: total >= MAX_NAMES,
		over: total > MAX_NAMES,
		more: newCount > Math.max(0, MAX_NAMES - typedCount),
	};
}

/**
 * Whether closing the window would lose something the user did: typed names, text not yet a name, or ticks that
 * differ from the ones the window made itself. Choosing a credential and the auto-ticked zones alone are no work.
 *
 * @param   {{ typed: string[]|undefined, pending: boolean, ticked: Set<string>, auto: Set<string> }} state
 * @returns {boolean}
 */
export function hasUnsavedWork({ typed, pending, ticked, auto }) {
	if ((typed?.length ?? 0) > 0 || pending) return true;
	if (ticked.size !== auto.size) return true;
	for (const name of ticked) if (!auto.has(name)) return true;
	return false;
}

const TRAILING_DOT = /\.$/u;
const nameKey = (name) => name.trim().toLowerCase().replace(TRAILING_DOT, "");

/**
 * The body of the one create request of the window: the typed names and the ticked zones, each name once. A name
 * both typed and ticked goes with the typed ones (the user typed it). An empty list is left out (the API needs at
 * least one name in total).
 *
 * @param   {number} dnsCredentialId
 * @param   {string[]} typed   the typed names
 * @param   {Iterable<string>} ticked  the ticked zone names
 * @returns {{ dnsCredentialId: number, names?: string[], fetchedNames?: string[] }}
 */
export function saveBody(dnsCredentialId, typed, ticked) {
	const seen = new Set();
	const once = (list) =>
		list.filter((name) => {
			const key = nameKey(name);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	const names = once(typed ?? []);
	const fetchedNames = once([...ticked]);
	return {
		dnsCredentialId,
		...(names.length > 0 && { names }),
		...(fetchedNames.length > 0 && { fetchedNames }),
	};
}
