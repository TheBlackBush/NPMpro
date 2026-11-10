import { createHostResolver } from "./host-resolver.js";
import { ALL_HOSTS } from "./rollup.js";

const OTHER_HOST = "_other";

/**
 * Maps a request host to the host key that is stored: a managed domain name, the managed wildcard name it
 * matches (`*.example.com`, `.example.com`) or `_other` for everything else (default site, IPs, random names).
 * Storing the wildcard name instead of the real sub domain keeps the tables bounded.
 * Trailing wildcards (`www.example.*`) and regex names are not matched: their requests fall back to `_other`.
 * Every configured host counts as managed, also a disabled one (its requests reach the default site anyway).
 *
 * A name that is only "*" maps to _other: "*" is the key of the all-hosts totals.
 *
 * @param   {Iterable<string>}  domains  domain names of the managed hosts
 * @returns {((host: string) => string) & {keys: Set<string>}}  `keys` holds every key it can return
 */
const createHostMapper = (domains) => {
	const exact = new Set();
	const wildcards = [];
	for (const raw of domains) {
		const name = String(raw ?? "")
			.trim()
			.toLowerCase();
		if (name === "" || name === ALL_HOSTS) continue;
		if (name.startsWith("*.")) {
			wildcards.push({ name, suffix: name.slice(1), self: null });
		} else if (name.startsWith(".")) {
			wildcards.push({ name, suffix: name, self: name.slice(1) });
		} else {
			exact.add(name);
		}
	}
	// longest suffix first, like nginx picks the longest matching wildcard
	wildcards.sort((a, b) => b.suffix.length - a.suffix.length);
	const map = (host) => {
		if (host && exact.has(host)) return host;
		if (host) {
			for (const w of wildcards) {
				if (host === w.self || (host.endsWith(w.suffix) && host.length > w.suffix.length)) return w.name;
			}
		}
		return OTHER_HOST;
	};
	// every key the mapper can return
	map.keys = new Set([...exact, ...wildcards.map((w) => w.name), OTHER_HOST]);
	return map;
};

/**
 * The managed host list: the key mapper and the resolver built from the last successful load. A failed reload
 * keeps the previous ones. The state stays in here; callers use the methods.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.loadHosts  () => Promise<Array<{id, type, domain_names}>>
 * @param   {Object}    deps.recent     the recent requests (told which host keys are still counted)
 * @param   {Function}  deps.now
 * @param   {Function}  deps.logError   (what) => (err) => void
 * @returns {{refresh: Function, loadedSince: Function, map: Function, resolver: Function, hostsAt: Function,
 *            error: Function, inFlight: Function}}
 */
const createHostList = ({ loadHosts, recent, now, logError }) => {
	let mapHost = createHostMapper([]);
	// null until the host list was loaded once
	let resolver = null;
	// start time of the last successful load, null before it and after a failed one (the next read or API call
	// retries)
	let hostsAt = null;
	let hostsInFlight = null;
	let hostsError = null;

	const loadOnce = async () => {
		const at = now();
		try {
			const hosts = await loadHosts();
			mapHost = createHostMapper(hosts.flatMap((host) => host.domain_names ?? []));
			resolver = createHostResolver(hosts);
			// per host lists of keys that are no longer counted (host removed or renamed)
			recent.keepHosts(mapHost.keys);
			hostsAt = at;
			hostsError = null;
		} catch (err) {
			hostsAt = null;
			// retried on every read while it fails: logged once until a load succeeds
			if (hostsError !== err?.message) logError("could not read the host list")(err);
			hostsError = err?.message ?? String(err);
		}
	};

	/** Reloads the managed hosts; a reload still running is shared. */
	const refresh = () => {
		hostsInFlight ??= loadOnce().finally(() => {
			hostsInFlight = null;
		});
		return hostsInFlight;
	};

	return {
		refresh,
		/** Waits for a host list whose load started at or after `time` (a reload in flight is awaited first). */
		loadedSince: async (time) => {
			if (hostsAt !== null && hostsAt >= time) return;
			if (hostsInFlight) await hostsInFlight;
			if (hostsAt === null || hostsAt < time) await refresh();
		},
		map: (host) => mapHost(host),
		resolver: () => resolver,
		hostsAt: () => hostsAt,
		error: () => hostsError,
		inFlight: () => hostsInFlight,
	};
};

export { createHostList, createHostMapper };
