import { Resolver } from "node:dns/promises";

// codes that mean the address gave no DNS answer; any other outcome (an answer, an error rcode such as ENOTFOUND or
// ENODATA, SERVFAIL) shows that something answers on it
const NO_ANSWER = new Set(["ETIMEOUT", "ECONNREFUSED", "ECONNRESET", "ECANCELLED"]);
const GRACE_MS = 50;

const defaultCreateResolver = (timeoutMs) => new Resolver({ timeout: timeoutMs, tries: 1 });

const answers = async (address, timeoutMs, createResolver) => {
	let timer;
	try {
		const resolver = createResolver(timeoutMs);
		resolver.setServers([address]);
		const ask = resolver.resolveNs(".").then(
			() => true,
			(err) => !NO_ANSWER.has(err?.code),
		);
		// the resolver has its own timeout; this one also ends a query that never settles
		const limit = new Promise((resolve) => {
			timer = setTimeout(() => resolve(false), timeoutMs + GRACE_MS);
		});
		return await Promise.race([ask, limit]);
	} catch {
		// a setServers that throws counts as no answer
		return false;
	} finally {
		clearTimeout(timer);
	}
};

/**
 * Asks each address for the root name servers, all in parallel; never throws
 *
 * @param   {Array<string>}  addresses  resolver addresses (1.1.1.1, 1.1.1.1:53, [2606:4700::1111]:53)
 * @param   {Object}         [options]
 * @param   {number}         [options.timeoutMs]        how long one address may take
 * @param   {Function}       [options.createResolver]   (timeoutMs) => { setServers, resolveNs }, for the tests
 * @returns {Promise<Array<string>>}  the addresses that did not answer
 */
const probeResolvers = async (addresses, { timeoutMs = 3000, createResolver = defaultCreateResolver } = {}) => {
	const results = await Promise.all(addresses.map((address) => answers(address, timeoutMs, createResolver)));
	return addresses.filter((_, index) => !results[index]);
};

export { probeResolvers };
