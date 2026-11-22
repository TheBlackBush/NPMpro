// Which hosts a changed list of certificate names leaves uncovered. Pure, so node --test checks it without a DOM.

/**
 * Whether a certificate name covers a host name: the same name in any case, or a wildcard `*.x` for one label under x
 *
 * @param {string} name    a name of the certificate
 * @param {string} domain  a name of a host
 * @returns {boolean}
 */
export function covers(name, domain) {
	const certificateName = name.toLowerCase();
	const hostName = domain.toLowerCase();
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
