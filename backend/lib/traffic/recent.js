/**
 * The most recent requests, in memory only (empty after a restart): the newest `overall` entries and the newest
 * `perHost` entries per stored host key, so a busy host cannot push a quiet host's entries out of its own list.
 * Entries are `{ time, host, method, path, status, bytes, country, ip? }` with time in ms.
 *
 * @param   {Object}  [options]
 * @param   {number}  [options.overall]
 * @param   {number}  [options.perHost]
 * @returns {{add: Function, list: Function, forgetIps: Function, keepHosts: Function, clear: Function}}
 */
const createRecent = ({ overall = 200, perHost = 50 } = {}) => {
	// oldest first; seq orders entries with the same time by arrival
	let all = [];
	let byHost = new Map();
	let seq = 0;

	const trim = (list, max) => {
		if (list.length > max) list.splice(0, list.length - max);
	};

	const newestFirst = (a, b) => b.time - a.time || b.seq - a.seq;

	const output = ({ seq: _seq, ...entry }) => entry;

	return {
		add: (entry) => {
			const item = { ...entry, seq: seq++ };
			all.push(item);
			trim(all, overall);
			let list = byHost.get(item.host);
			if (!list) {
				list = [];
				byHost.set(item.host, list);
			}
			list.push(item);
			trim(list, perHost);
		},

		/**
		 * @param   {Object}         [options]
		 * @param   {string[]|null}  [options.keys]   stored host keys; null for the overall list
		 * @param   {number}         [options.limit]
		 * @returns {Object[]}  copies, newest first
		 */
		list: ({ keys = null, limit = 100 } = {}) => {
			const source = keys === null ? all : [...new Set(keys)].flatMap((key) => byHost.get(key) ?? []);
			return [...source].sort(newestFirst).slice(0, limit).map(output);
		},

		/** Removes the IP from every kept entry ("show visitor IPs" was switched off). */
		forgetIps: () => {
			for (const item of all) delete item.ip;
			for (const list of byHost.values()) for (const item of list) delete item.ip;
		},

		/**
		 * Drops the per host lists of keys that are no longer counted (the host was removed or renamed); their
		 * entries stay in the overall list until newer ones push them out.
		 *
		 * @param {Set<string>} keys  the host keys still in use
		 */
		keepHosts: (keys) => {
			for (const key of byHost.keys()) if (!keys.has(key)) byHost.delete(key);
		},

		clear: () => {
			all = [];
			byHost = new Map();
		},
	};
};

export { createRecent };
