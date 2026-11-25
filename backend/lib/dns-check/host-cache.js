// The cache of the host check: in memory, per host and per scope (who asked: the provider read depends on the user's
// rights), 30 s of reuse, 2000 entries at most (the oldest is dropped). It holds states, addresses, names and
// scrubbed messages only. A host's entries go when the host changes; a restart loses them all.

const REUSE_MS = 30_000;
const MAX_ENTRIES = 2000;

// the host type of the services (hostType) as the API names it; a stream has no names
const API_TYPES = { proxy_host: "proxy", redirection_host: "redirection", dead_host: "dead" };

const createHostCache = ({ now = () => Date.now() } = {}) => {
	const entries = new Map();
	let generation = 0;
	const keyOf = (type, id, scope) => `${type}:${id}:${scope}`;

	return {
		/** @returns {Object|undefined}  the entry of that host and scope, fresh or not */
		get: (type, id, scope) => entries.get(keyOf(type, id, scope)),
		fresh: (entry) => entry !== undefined && now() - entry.at < REUSE_MS,
		/** a number that changes at every clear: a check that started under another one does not write its result */
		generation: () => generation,
		set: (type, id, scope, { since = generation, ...entry }) => {
			if (since !== generation) return false;
			const key = keyOf(type, id, scope);
			entries.delete(key);
			entries.set(key, { ...entry, type, id, scope, at: now() });
			while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
			return true;
		},
		/** the entries of one scope */
		ofScope: (scope) => [...entries.values()].filter((entry) => entry.scope === scope),
		/** forget a host in every scope; the type is the API's (proxy) or the service's (proxy_host) */
		clearHost: (type, id) => {
			generation += 1;
			const apiType = API_TYPES[type] ?? type;
			for (const [key, entry] of entries)
				if (entry.type === apiType && entry.id === Number(id)) entries.delete(key);
		},
		/** forget every host (a restore or a merge replaced the hosts) */
		clearAll: () => {
			generation += 1;
			entries.clear();
		},
		size: () => entries.size,
	};
};

const hostCheckCache = createHostCache();

export { createHostCache, hostCheckCache, MAX_ENTRIES, REUSE_MS };
