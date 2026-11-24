// Host names the server suggests keeping updated ({ name, zone, dnsCredentialId, credentialName }): the picking rules

/** The suggestions of the names a host has (compared without case), in the order of the host's names */
const suggestionsFor = (domainNames, suggestions) => {
	const wanted = (Array.isArray(domainNames) ? domainNames : []).map((name) => String(name).toLowerCase());
	const byName = new Map((suggestions ?? []).map((entry) => [entry.name.toLowerCase(), entry]));
	const found = [];
	for (const name of wanted) {
		const entry = byName.get(name);
		if (entry !== undefined && !found.includes(entry)) found.push(entry);
	}
	return found;
};

/** What the Add button of the tab does: nothing, open the window for the one name, or ask which of several */
const suggestionChoice = (suggestions) => {
	const list = suggestions ?? [];
	if (list.length === 0) return { kind: "none", first: null };
	return { kind: list.length === 1 ? "one" : "many", first: list[0] };
};

/** The values the record window starts with */
const recordPrefill = (suggestion) => ({ name: suggestion.name, credentialId: suggestion.dnsCredentialId });

export { recordPrefill, suggestionChoice, suggestionsFor };
