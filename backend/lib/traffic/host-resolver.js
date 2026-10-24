const OTHER_KEY = "_other";
// table order: a name listed by two hosts belongs to the first (nginx rejects duplicates, this keeps it deterministic)
const TYPE_ORDER = ["proxy", "redirection", "dead"];

const normalise = (name) =>
	String(name ?? "")
		.trim()
		.toLowerCase();

/**
 * Maps stored traffic host keys to the NPMpro host that owns them. A stored key is a managed domain name or the
 * wildcard name a host lists (`*.example.com`, `.example.com`), so matching is an exact, lower-cased lookup.
 *
 * @param   {Array<{id: number, type: "proxy"|"redirection"|"dead", domain_names: string[]}>}  list
 * @returns {{ownerOf: Function, keysFor: Function, hosts: Function}}
 */
const createHostResolver = (list) => {
	const hosts = [...list].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
	const owners = new Map();
	const byId = new Map();
	for (const host of hosts) {
		const names = (host.domain_names ?? []).map(normalise).filter((name) => name !== "");
		const entry = {
			host_id: host.id,
			host_type: host.type,
			name: names[0] ?? "",
			domain_names: names,
		};
		byId.set(`${host.type}|${host.id}`, entry);
		for (const name of names) {
			if (!owners.has(name)) owners.set(name, entry);
		}
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

export { createHostResolver };
