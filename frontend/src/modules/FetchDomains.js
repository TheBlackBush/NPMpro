// The zone section of the Add domains window: what an answer of GET /nginx/dns-credentials/{id}/provider-domains (or its
// error) shows, which zones start ticked and the body of the save. Pure.

import { displayDomain } from "./DnsDomainForms.js";

const HINTED = new Set(["cloudflare", "digitalocean", "ovh"]);
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

/**
 * @param   {{ name: string, state: string }[]|undefined} zones
 * @returns {Set<string>}  every new zone
 */
export function initialSelection(zones) {
	return new Set((zones ?? []).filter((zone) => zone.state === "new").map((zone) => zone.name));
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
