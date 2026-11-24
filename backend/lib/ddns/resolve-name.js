import { Resolver } from "node:dns/promises";
import { isTestOutbound } from "../outbound-guard.js";

// The check resolver of the engine: what a record's name answers now, so a record that is already right needs no
// provider call. null means "unknown" (no answer, an error, or the tests): the engine then asks the provider.

const TIMEOUT_MS = 3000;
const TRIES = 2;

/**
 * @param   {String}    name     the full record name
 * @param   {String}    type     A or AAAA
 * @param   {String[]}  servers  resolver addresses; none: the system's
 * @returns {Promise<String[]|null>}
 */
const resolveName = async (name, type, servers = []) => {
	if (isTestOutbound()) return null;
	try {
		const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: TRIES });
		if (servers.length > 0) resolver.setServers(servers);
		return type === "AAAA" ? await resolver.resolve6(name) : await resolver.resolve4(name);
	} catch {
		return null;
	}
};

export { resolveName };
