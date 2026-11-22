import { bareName, matchNames, uncoveredBy } from "./DnsDomainMatch.js";

// What the DNS challenge box suggests for the names of its window (D3): the credential whose domains cover every
// name is preselected with a note saying why, until the user picks a provider or credential by hand; a hand pick that
// does not cover every name gets a warning, never a change. Spread names and ties are shown, not guessed. Pure.

/**
 * @param   {Object}    input
 * @param   {string[]}  input.names         the window's domain names
 * @param   {Object[]}  [input.zones]       suggestion zones (camelCase rows)
 * @param   {Object[]}  [input.credentials] the DNS credentials the user sees ({ id, name })
 * @param   {number}    [input.userId]      the signed-in user
 * @param   {number|null} [input.credentialId]  the credential field's value
 * @param   {boolean}   [input.handPicked]  the user chose the provider or the credential
 * @returns {{ preselect: Object|null, note: Object|null }}
 */
export function challengeSuggestion({ names, zones, credentials, userId, credentialId = null, handPicked = false }) {
	const list = (names ?? []).filter((name) => bareName(name) !== "");
	const none = { preselect: null, note: null };
	if (list.length === 0) return none;
	const matchZones = (zones ?? []).map((zone) => ({
		name: zone.name,
		credentialId: zone.dnsCredentialId,
		ownerUserId: zone.ownerUserId,
	}));
	const zoneOf = (id) => (zones ?? []).find((zone) => zone.dnsCredentialId === id);
	const nameOf = (id) =>
		credentials?.find((credential) => credential.id === id)?.name ?? zoneOf(id)?.credentialName ?? `#${id}`;

	if (handPicked && credentialId) {
		const missing = uncoveredBy(list, credentialId, matchZones);
		return {
			preselect: null,
			note:
				missing.length > 0
					? { kind: "not-covered", credentialName: nameOf(credentialId), names: missing }
					: null,
		};
	}
	// a provider picked by hand without a credential: nothing is suggested
	if (handPicked) return none;
	const match = matchNames(list, matchZones, userId);
	switch (match.kind) {
		case "one":
			return {
				preselect: { provider: zoneOf(match.credentialId).provider, credentialId: match.credentialId },
				note: {
					kind: "suggested",
					credentialName: nameOf(match.credentialId),
					zones: match.zones,
					count: list.length,
				},
			};
		case "conflict":
			return {
				preselect: null,
				note: {
					kind: "conflict",
					names: match.names,
					credentials: match.credentialIds.map((id) => ({
						name: nameOf(id),
						ownerName: zoneOf(id)?.ownerName ?? "",
					})),
				},
			};
		case "spread":
			return {
				preselect: null,
				note: {
					kind: "spread",
					groups: match.groups.map((group) => ({
						credentialName: nameOf(group.credentialId),
						names: group.names,
					})),
				},
			};
		case "partial":
			return { preselect: null, note: { kind: "partial", names: match.uncovered } };
		default:
			return none;
	}
}

/**
 * What the DNS challenge box does to its fields after a suggestion (the component only applies it). It sets a
 * preselection only into empty fields or fields that still hold what it applied before, never over a hand pick or a
 * saved credential, and clears only values it applied itself.
 *
 * @param   {Object}      input
 * @param   {Object|null} input.preselect      { provider, credentialId } of challengeSuggestion
 * @param   {string|null} [input.providerId]   the provider field's value
 * @param   {number|null} [input.credentialId] the credential field's value
 * @param   {Object|null} [input.applied]      { provider, credentialId } this box applied before
 * @param   {boolean}     [input.handPicked]   the user chose the provider or the credential
 * @returns {{ set: Object|null, clear: boolean, applied: Object|null }}
 */
export function suggestionStep({
	preselect,
	providerId = null,
	credentialId = null,
	applied = null,
	handPicked = false,
}) {
	if (handPicked) return { set: null, clear: false, applied };
	const holdsApplied = applied !== null && providerId === applied.provider && credentialId === applied.credentialId;
	const empty = !providerId && !credentialId;
	if (preselect) {
		if (!(holdsApplied || empty)) return { set: null, clear: false, applied };
		const same = providerId === preselect.provider && credentialId === preselect.credentialId;
		return { set: same ? null : preselect, clear: false, applied: preselect };
	}
	return { set: null, clear: holdsApplied, applied: null };
}
