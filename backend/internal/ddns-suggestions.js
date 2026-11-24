import { updaterFor } from "../lib/ddns/providers/index.js";
import { bareName } from "../lib/dns-domain-match.js";
import dnsDomainModel from "../models/dns_domain.js";
import internalDdnsRecord from "./ddns-record.js";
import internalDnsDomain, { mayView, namesOfRow, ownOnly, suggestedName } from "./dns-domain.js";

// Host names the user may view that fall under a zone a Dynamic DNS record could update and have no record yet

const MAX_SUGGESTIONS = 100;
const HOST_SOURCES = [
	{ table: "proxy_host", permission: "proxy_hosts:view" },
	{ table: "redirection_host", permission: "redirection_hosts:view" },
	{ table: "dead_host", permission: "dead_hosts:view" },
];

const covers = (zone, name) => name === zone || name.endsWith(`.${zone}`);

// the zones of the visible credentials whose provider has an updater with a zone (not a preset, not custom) the
// user may use
const usableZones = async (access) => {
	const zones = [];
	for (const row of await internalDnsDomain.getAll(access, { expand: ["credential"] })) {
		const updater = updaterFor(row.credential.provider);
		if (updater === null || updater.zoneless === true) continue;
		if (updater.adminOnly === true && !access.isAdmin) continue;
		zones.push({ zone: bareName(row.name), credential: row.credential });
	}
	return zones;
};

// the longest zone that covers the name; on a tie the first credential
const zoneOf = (name, zones) => {
	let best = null;
	for (const zone of zones) {
		if (covers(zone.zone, name) && (best === null || zone.zone.length > best.zone.length)) best = zone;
	}
	return best;
};

const hostNames = async (access) => {
	const names = new Set();
	for (const { table, permission } of HOST_SOURCES) {
		if (!mayView(access, permission)) continue;
		const query = dnsDomainModel.knex()(table).select("domain_names");
		if (ownOnly(access)) query.where("owner_user_id", access.token.getUserId(1));
		for (const row of await query) {
			for (const name of namesOfRow(row.domain_names)) {
				const normalized = suggestedName(name);
				if (normalized !== null && !normalized.startsWith("*.")) names.add(normalized);
			}
		}
	}
	return [...names].sort((a, b) => a.localeCompare(b));
};

/**
 * @param   {Access}  access
 * @returns {Promise<Array<{ name: string, zone: string, dns_credential_id: number, credential_name: string }>>}
 */
const suggestions = async (access) => {
	access.can("certificates:view");
	const zones = await usableZones(access);
	if (zones.length === 0) return [];
	const taken = new Set((await internalDdnsRecord.getAll(access)).map((record) => record.name));
	const found = [];
	for (const name of await hostNames(access)) {
		if (taken.has(name)) continue;
		const zone = zoneOf(name, zones);
		if (zone === null) continue;
		found.push({
			name,
			zone: zone.zone,
			dns_credential_id: zone.credential.id,
			credential_name: zone.credential.name,
		});
		if (found.length === MAX_SUGGESTIONS) break;
	}
	return found;
};

export { suggestions };
