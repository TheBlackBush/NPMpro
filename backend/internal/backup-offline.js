import { TYPES } from "../lib/backup/types.js";

const HOST_TYPES = ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams"];
const MAX_HOST_ERROR = 500;
const OFFLINE = new Set([0, false, "0", null]);
// an nginx error about a file in the custom nginx folder, e.g. "in /data/custom_nginx/server_proxy.conf:1"
const CUSTOM_NGINX_ERROR = /\/custom_nginx\//u;

// a host's first domain name, a stream's incoming port
const hostLabel = (row) => {
	let names = row.domain_names;
	if (typeof names === "string") {
		try {
			names = JSON.parse(names);
		} catch {
			names = [];
		}
	}
	if (Array.isArray(names) && names.length > 0) return String(names[0]);
	return row.incoming_port === undefined || row.incoming_port === null ? "" : String(row.incoming_port);
};

// reading which hosts nginx serves, and refusing an apply that takes one offline
const createOfflineChecks = ({ knex }) => {
	/**
	 * The enabled hosts nginx rejected in the regeneration (kept as .err): it renders all hosts, so a restore of
	 * certificates or access lists can break hosts too. They do not fail the restore.
	 *
	 * @returns {Promise<Array<{ type: string, id: number, domain: string, error: string }>>}
	 */
	const offlineHosts = async () => {
		const out = [];
		for (const typeId of HOST_TYPES) {
			const { table } = TYPES[typeId].tables[0];
			for (const row of await knex(table).where("enabled", 1).orderBy("id")) {
				if (!OFFLINE.has(row.npmpro_nginx_online)) continue;
				out.push({
					type: table,
					id: row.id,
					domain: hostLabel(row),
					error: String(row.npmpro_nginx_err ?? "").slice(0, MAX_HOST_ERROR),
				});
			}
		}
		return out;
	};

	// "proxy_host:1" of every enabled host nginx serves now
	const onlineHosts = async () => {
		const out = new Set();
		for (const typeId of HOST_TYPES) {
			const { table } = TYPES[typeId].tables[0];
			for (const row of await knex(table).where("enabled", 1).select("id", "npmpro_nginx_online")) {
				if (!OFFLINE.has(row.npmpro_nginx_online)) out.add(`${table}:${row.id}`);
			}
		}
		return out;
	};

	/**
	 * A changed custom nginx file breaks hosts one by one: the regeneration keeps the config of each host it breaks as
	 * .err, and nginx -t of the whole configuration passes. A host that was online before and is offline now, or an
	 * offline host whose nginx error names a custom nginx file (a host the apply brought in), fails the apply as
	 * nginx -t would, so that it is rolled back.
	 *
	 * @param {Set<string>} wereOnline  from onlineHosts() before the apply
	 */
	const refuseTakenOffline = async (wereOnline) => {
		const taken = (await offlineHosts()).filter(
			(host) => wereOnline.has(`${host.type}:${host.id}`) || CUSTOM_NGINX_ERROR.test(host.error),
		);
		if (taken.length === 0) return;
		const names = taken.map((host) => host.domain).join(", ");
		throw new Error(`${names} would go offline: ${taken[0].error}`);
	};

	return { offlineHosts, onlineHosts, refuseTakenOffline };
};

export { createOfflineChecks };
