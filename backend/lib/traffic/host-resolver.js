const OTHER_KEY = "_other";
// table order: a name listed by two hosts belongs to the first (nginx rejects duplicates, this keeps it deterministic)
const TYPE_ORDER = ["proxy", "redirection", "dead"];
// the host types whose missing pages are counted
const PATH_TYPES = new Set(["proxy", "redirection"]);

const normalise = (name) =>
	String(name ?? "")
		.trim()
		.toLowerCase();

/**
 * The hosts in table order with their normalised names and the names each one owns: a name listed by two hosts
 * belongs to the first.
 *
 * @param   {Array<{id: number, type: string, domain_names: string[]}>}  list
 * @returns {Array<{host: Object, names: string[], owned: string[]}>}
 */
const claimNames = (list) => {
	const taken = new Set();
	return [...list]
		.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type))
		.map((host) => {
			const names = (host.domain_names ?? []).map(normalise).filter((name) => name !== "");
			const owned = names.filter((name) => {
				if (taken.has(name)) return false;
				taken.add(name);
				return true;
			});
			return { host, names, owned };
		});
};

/**
 * Maps stored traffic host keys to the NPMpro host that owns them. A stored key is a managed domain name or the
 * wildcard name a host lists (`*.example.com`, `.example.com`), so matching is an exact, lower-cased lookup.
 *
 * @param   {Array<{id: number, type: "proxy"|"redirection"|"dead", domain_names: string[]}>}  list
 * @returns {{ownerOf: Function, keysFor: Function, hosts: Function}}
 */
const createHostResolver = (list) => {
	const claimed = claimNames(list);
	const hosts = claimed.map(({ host }) => host);
	const owners = new Map();
	const byId = new Map();
	for (const { host, names, owned } of claimed) {
		const entry = {
			host_id: host.id,
			host_type: host.type,
			name: names[0] ?? "",
			domain_names: names,
		};
		byId.set(`${host.type}|${host.id}`, entry);
		for (const name of owned) owners.set(name, entry);
	}

	return {
		/**
		 * @param   {string}  key  stored host key
		 * @returns {{host_id: number|null, host_type: string, name: string, domain_names: string[]}}
		 */
		ownerOf: (key) => {
			if (key === OTHER_KEY) return { host_id: null, host_type: "other", name: OTHER_KEY, domain_names: [] };
			const owner = owners.get(normalise(key));
			if (owner) return { ...owner, domain_names: [...owner.domain_names] };
			return { host_id: null, host_type: "deleted", name: key, domain_names: [key] };
		},

		/**
		 * The stored keys a host can have: the domain names it owns, lower-cased. Null when the host does not exist.
		 *
		 * @param   {string}  type
		 * @param   {number}  id
		 * @returns {string[]|null}
		 */
		keysFor: (type, id) => {
			const entry = byId.get(`${type}|${id}`);
			// a name an earlier host lists as well is counted under that host, so it is not part of this filter
			return entry ? entry.domain_names.filter((name) => owners.get(name) === entry) : null;
		},

		hosts: () => hosts,
	};
};

/**
 * The stored host keys whose missing pages are counted: the names of enabled proxy and redirection hosts, mapped to
 * the host type. A name listed by two hosts belongs to the first in table order (like ownerOf); a disabled host's
 * requests reach the default site, so its 404s are not its missing pages. Built once per host list, so the per line
 * check is one Map lookup.
 *
 * @param   {Array<{id: number, type: string, domain_names: string[], enabled?: boolean}>}  list
 * @returns {Map<string, "proxy"|"redirection">}
 */
const pathHostTypes = (list) => {
	const types = new Map();
	for (const { host, owned } of claimNames(list)) {
		if (!PATH_TYPES.has(host.type) || host.enabled === false) continue;
		for (const name of owned) types.set(name, host.type);
	}
	return types;
};

export { createHostResolver, pathHostTypes };
