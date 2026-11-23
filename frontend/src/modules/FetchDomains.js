// The state of the Fetch domains window: what an answer of GET /nginx/dns-credentials/{id}/provider-domains (or its
// error) shows, and which zones start ticked. Pure.

import { displayDomain } from "./DnsDomainForms.js";

const HINTED = new Set(["cloudflare", "digitalocean", "ovh"]);

/**
 * @param   {string|undefined} provider  the provider id of the credential
 * @returns {string}  the translation id of the hint shown under an error
 */
export function hintIdOf(provider) {
	return `dns-domains.fetch.hint.${HINTED.has(provider) ? provider : "other"}`;
}

/**
 * @param   {{ supported: boolean, truncated: boolean, zones: { name: string, state: string, credentialName?: string }[] }|undefined} answer
 * @param   {unknown} error     the error of the request, if it failed
 * @param   {string} [provider] the provider id of the credential, for the hint
 * @returns {{ kind: "loading"|"list"|"empty"|"error"|"not-supported", rows: object[], hintId: string|null, truncated: boolean }}
 */
export function fetchState(answer, error, provider) {
	if (answer && !answer.supported) {
		return { kind: "not-supported", rows: [], hintId: null, truncated: false };
	}
	if (error) {
		return { kind: "error", rows: [], hintId: hintIdOf(provider), truncated: false };
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
