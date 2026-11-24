import { Resolver } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { isTestOutbound } from "../outbound-guard.js";
import { checkTiming } from "./timing.js";

// One DNS lookup through the check resolver (the ddns.resolver setting, else the container's resolvers): each try is
// raced against its own timer (checkTiming.tryMs, 3 s) and a try that times out is made once more (checkTiming.tries,
// two), so a lookup ends within about 6 s whatever c-ares does with its own timeouts. It answers { ok: true, values }
// or { ok: false, code } and never throws. Types: A, AAAA, CAA (a CAA value is { critical, issue | issuewild | iodef |
// ... }). Under the test outbound mode it reads the map file NPMPRO_TEST_DNS (written by test/support/api.js) and
// never the network; an entry { delay: ms, answer } answers late, for the tests of the timers.

const CODES = new Map([
	["ENODATA", "nodata"],
	["ENOTFOUND", "nxdomain"],
	["ESERVFAIL", "servfail"],
	["ETIMEOUT", "timeout"],
]);

const codeOf = (error) => CODES.get(error?.code) ?? "error";

const MAX_ALIASES = 5;

const mapEntry = (name, type, depth = 0) => {
	let map = {};
	try {
		map = JSON.parse(readFileSync(process.env.NPMPRO_TEST_DNS ?? "", "utf8"));
	} catch {
		map = {};
	}
	const entry = map[`${String(name).toLowerCase()}|${type}`];
	if (entry === undefined) return { ok: false, code: "nxdomain" };
	// { cname: "target.example" }: the resolver follows the alias, as the real one does
	if (typeof entry.cname === "string" && depth < MAX_ALIASES) return mapEntry(entry.cname, type, depth + 1);
	return entry;
};

const fromEntry = (entry) => {
	if (Array.isArray(entry)) return entry.length === 0 ? { ok: false, code: "nodata" } : { ok: true, values: entry };
	if (entry?.ok === false) return entry;
	return { ok: false, code: entry.code ?? "error" };
};

const fromMap = async (name, type) => {
	const entry = mapEntry(name, type);
	if (entry?.ok === false && entry.code === "nxdomain") return entry;
	if (Number.isFinite(entry?.delay)) {
		// never keeps the test process alive
		await sleep(entry.delay, undefined, { ref: false });
		return fromEntry(entry.answer ?? []);
	}
	return fromEntry(entry);
};

const TIMED_OUT = { ok: false, code: "timeout" };
const timedOut = (result) => result.ok === false && result.code === "timeout";

/** one try: the query, or a timeout when its timer ends first (the query is then cancelled) */
const raceTry = (query, cancel) =>
	new Promise((resolve) => {
		const timer = setTimeout(() => {
			cancel?.();
			resolve(TIMED_OUT);
		}, checkTiming.tryMs);
		query().then(
			(result) => {
				clearTimeout(timer);
				resolve(result);
			},
			() => {
				clearTimeout(timer);
				resolve({ ok: false, code: "error" });
			},
		);
	});

const queryOnce = async (resolver, name, type) => {
	try {
		let values;
		if (type === "AAAA") values = await resolver.resolve6(name);
		else if (type === "CAA") values = await resolver.resolveCaa(name);
		else values = await resolver.resolve4(name);
		return values.length === 0 ? { ok: false, code: "nodata" } : { ok: true, values };
	} catch (error) {
		return { ok: false, code: codeOf(error) };
	}
};

/**
 * @param   {String}    name
 * @param   {String}    type     A, AAAA or CAA
 * @param   {String[]}  servers  resolver addresses; none: the system's
 * @param   {Function}  [makeResolver]  (options) => resolver; the node Resolver by default (the tests pass a fake)
 * @returns {Promise<{ ok: true, values: Array } | { ok: false, code: String }>}  code: nodata, nxdomain, servfail,
 *          timeout or error
 */
const lookup = async (name, type, servers = [], makeResolver = (options) => new Resolver(options)) => {
	const test = isTestOutbound();
	let result = TIMED_OUT;
	for (let attempt = 0; attempt < checkTiming.tries && timedOut(result); attempt += 1) {
		if (test) {
			result = await raceTry(() => fromMap(name, type));
			continue;
		}
		let resolver;
		try {
			// one try per resolver: the retry is ours, with its own timer
			resolver = makeResolver({ timeout: checkTiming.tryMs, tries: 1 });
			if (servers.length > 0) resolver.setServers(servers);
		} catch (error) {
			return { ok: false, code: codeOf(error) };
		}
		result = await raceTry(
			() => queryOnce(resolver, name, type),
			() => resolver.cancel?.(),
		);
	}
	return result;
};

export { lookup };
