// Which hosts a changed list of certificate names leaves uncovered. Pure, so node --test checks it without a DOM.

/**
 * The ASCII (punycode, lower case) form of a name, so a Unicode name and its punycode form compare equal; a name the
 * URL parser refuses is compared as typed. A wildcard keeps its `*.`.
 */
export function asciiName(name) {
	const wildcard = name.startsWith("*.");
	const rest = wildcard ? name.slice(2) : name;
	let ascii = rest.toLowerCase();
	try {
		ascii = new URL(`http://${rest}`).hostname;
	} catch {
		// compared as typed
	}
	return wildcard ? `*.${ascii}` : ascii;
}

/**
 * Whether the two lists hold the same names: as sets, in the ASCII form, like the backend's check
 *
 * @param {string[]} a
 * @param {string[]} b
 * @returns {boolean}
 */
export function sameNames(a, b) {
	const key = (names) => [...new Set(names.map(asciiName))].sort((x, y) => x.localeCompare(y)).join("\n");
	return key(a) === key(b);
}

/**
 * Whether a certificate name covers a host name: the same name in any case, or a wildcard `*.x` for one label under x
 *
 * @param {string} name    a name of the certificate
 * @param {string} domain  a name of a host
 * @returns {boolean}
 */
export function covers(name, domain) {
	const certificateName = asciiName(name);
	const hostName = asciiName(domain);
	if (certificateName === hostName) return true;
	if (!certificateName.startsWith("*.") || hostName.startsWith("*.")) return false;
	const rest = hostName.split(".").slice(1).join(".");
	return rest === certificateName.slice(2);
}

const HOST_LISTS = [
	["proxy", "proxyHosts"],
	["redirection", "redirectionHosts"],
	["dead", "deadHosts"],
];

/**
 * The hosts that use the certificate with names the new list does not cover (streams have no names)
 *
 * @param {string[]} names  the new names of the certificate
 * @param {Object}   certificate  a row of the certificates list with its host relations
 * @returns {{ type: "proxy"|"redirection"|"dead", id: number, domains: string[] }[]}
 */
export function uncoveredHosts(names, certificate) {
	const result = [];
	for (const [type, key] of HOST_LISTS) {
		for (const host of certificate[key] ?? []) {
			const domains = (host.domainNames ?? []).filter((domain) => !names.some((name) => covers(name, domain)));
			if (domains.length > 0) result.push({ type, id: host.id, domains });
		}
	}
	return result;
}

/**
 * The names the new list leaves uncovered, each once, in the order of the hosts
 *
 * @param {{ domains: string[] }[]} hosts  uncoveredHosts()
 * @returns {string[]}
 */
export function uncoveredNames(hosts) {
	return [...new Set(hosts.flatMap((host) => host.domains))];
}
