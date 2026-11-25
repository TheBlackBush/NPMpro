import { DdnsProviderError } from "../lib/ddns/errors.js";
import { providerFetch } from "../lib/ddns/provider-fetch.js";
import { updaterFor } from "../lib/ddns/providers/index.js";
import { ddnsSettingsOf } from "../lib/ddns/settings.js";
import { hostCheckCache } from "../lib/dns-check/host-cache.js";
import { checkName, unknownAnswer } from "../lib/dns-check/host-check.js";
import { limitConcurrency } from "../lib/dns-check/limit.js";
import { lookup } from "../lib/dns-check/lookup.js";
import { beforeDeadline, requestDeadline } from "../lib/dns-check/timing.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { bareName, coveringZone } from "../lib/dns-domain-match.js";
import errs from "../lib/error.js";
import { effectiveEnv } from "../lib/runtime-config.js";
import { global as logger } from "../logger.js";
import deadHostModel from "../models/dead_host.js";
import dnsCredentialModel from "../models/dns_credential.js";
import dnsDomainModel from "../models/dns_domain.js";
import proxyHostModel from "../models/proxy_host.js";
import redirectionHostModel from "../models/redirection_host.js";
import { publicAddressOf } from "./ddns.js";
import internalDnsCredential from "./dns-credential.js";

// The host check: where each name of a proxy, redirection or 404 host points (rules in lib/dns-check/host-check.js).
// Reads only: DNS lookups through the check resolver and, for a user who manages certificates, a record read at the
// provider of a visible covering credential. Results are cached in memory (lib/dns-check/host-cache.js).

const CONCURRENCY = 4;
// the names of one request, across its hosts (the UI sends its batches within it)
const MAX_NAMES = 200;
const PROVIDER_DEADLINE_MS = 30_000;
const UNREADABLE = "The DNS credential cannot be read";

const HOST_TYPES = {
	proxy: { model: proxyHostModel, section: "proxy_hosts" },
	redirection: { model: redirectionHostModel, section: "redirection_hosts" },
	dead: { model: deadHostModel, section: "dead_hosts" },
};

const canView = (access, type) => ["view", "manage"].includes(access.level(HOST_TYPES[type].section));
const ownOnly = (access) => access.visibility !== "all";

// who asked, as far as the provider read goes: a user who cannot manage certificates never reads a provider
const scopeOf = (access) => {
	if (access.level("certificates") !== "manage") return "view";
	return ownOnly(access) ? `u${access.token.getUserId(1)}` : "all";
};

const publicView = (entry) => ({
	type: entry.type,
	id: entry.id,
	checked_on: entry.checked_on,
	names: entry.names,
});

const namesOf = (row) => [...new Set((Array.isArray(row.domain_names) ? row.domain_names : []).map(String))];

/** the zones of the credentials the user may see, with their credential ids (also the host record option's) */
const loadZones = async (access) => {
	const query = dnsDomainModel
		.query()
		.joinRelated("credential")
		.select("npmpro_dns_domain.name", "npmpro_dns_domain.dns_credential_id", "credential.owner_user_id");
	if (ownOnly(access)) query.where("credential.owner_user_id", access.token.getUserId(1));
	return (await query).map((row) => ({
		name: row.name,
		credentialId: row.dns_credential_id,
		ownerUserId: row.owner_user_id,
	}));
};

const inZone = (zone, name) => name === zone || name.endsWith(`.${zone}`);

// the provider reads of one request: at most this many (a check must not use up a rate limit that certbot's DNS plugin
// and the DDNS updater share), and none more for a credential once it answered 429
const MAX_PROVIDER_READS = 50;
const READ_SKIPPED = "provider-read-skipped";

class ReadSkipped extends Error {
	name = "ReadSkipped";
}

/**
 * The provider read of one call (per user): A at the name and, when there is none, the wildcard at the direct parent
 * (Cloudflare and DigitalOcean only). null: no right, no visible covering credential, no read call, or the DNS answer
 * is already here on a provider whose answers are not the record (only Cloudflare is read always). { skipped } when
 * the request's reads are used up or the credential answered 429: the name keeps its DNS answer.
 *
 * The host record option (host-dns-record.js) reads through the same reader, with withAaaa (the AAAA at the name
 * too, when its box is ticked) and dnsHere false.
 *
 * @param   {Access}    access
 * @param   {Function}  limit   the request's concurrency limit
 * @param   {AbortSignal}  signal  the request's deadline
 * @param   {Object}    [deps]  the providers and their fetch (a test's fakes)
 * @param   {Function}  [deps.providerFor]  (credential provider) -> the provider with read and write, or null
 * @param   {Function}  [deps.fetchFor]     (secrets, deadline) -> the guarded fetch handed to a provider
 */
const createCoverage = (
	access,
	limit,
	signal,
	{
		providerFor = updaterFor,
		fetchFor = (secrets, deadline) => (url, options) => providerFetch(url, { ...options, secrets, deadline }),
	} = {},
) => {
	const manage = access.level("certificates") === "manage";
	let zones = null;
	const credentials = new Map();
	// one zone lookup per credential and zone, shared by the names of the request
	const metas = new Map();
	const rateLimited = new Set();
	let reads = 0;

	const credentialOf = async (id) => {
		if (!credentials.has(id)) credentials.set(id, dnsCredentialModel.query().findById(id));
		return await credentials.get(id);
	};

	const spend = (credentialId) => {
		if (rateLimited.has(credentialId) || reads >= MAX_PROVIDER_READS) throw new ReadSkipped();
		reads += 1;
	};
	const call = (credentialId, task) =>
		limit(async () => {
			spend(credentialId);
			try {
				return await task();
			} catch (error) {
				if (error instanceof DdnsProviderError && error.providerStatus === 429) rateLimited.add(credentialId);
				throw error;
			}
		});

	const metaOf = (credentialId, provider, args) => {
		const key = `${credentialId}|${args.zone}`;
		if (!metas.has(key)) {
			metas.set(
				key,
				typeof provider.zoneMeta === "function"
					? call(credentialId, () => provider.zoneMeta(args))
					: Promise.resolve({}),
			);
		}
		return metas.get(key);
	};

	return async (name, { dnsHere, withAaaa = false }) => {
		if (!manage) return null;
		zones ??= loadZones(access);
		const host = bareName(name);
		const cover = coveringZone(host, await zones, access.token.getUserId(1));
		if (cover === null || cover.credentialIds.length !== 1) return null;
		const credentialId = cover.credentialIds[0];
		const row = await credentialOf(credentialId);
		const provider = providerFor(row?.provider);
		if (provider === null) return null;
		if (dnsHere && provider.proxied !== true) return null;

		let fields;
		let secrets;
		try {
			fields = credentialFields(internalDnsCredential.openValues(row));
			secrets = secretValuesOf(row.provider, fields);
		} catch (error) {
			if (!(error instanceof errs.ValidationError)) throw error;
			return { record: null, wildcard: null, error: UNREADABLE };
		}
		const deadline = AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_DEADLINE_MS)]);
		const fetch = fetchFor(secrets, deadline);
		const base = { zone: cover.zone, fields, fetch };
		const read = async (readName, type = "A") => {
			const meta = await metaOf(credentialId, provider, base);
			return await call(credentialId, () => provider.read({ ...base, name: readName, type, meta: { ...meta } }));
		};
		try {
			const record = await read(host);
			const aaaa = withAaaa ? await read(host, "AAAA") : null;
			if (record !== null || aaaa !== null) {
				return {
					record: record === null ? null : { values: record.values, proxied: record.proxied === true },
					...(withAaaa ? { aaaa: aaaa === null ? null : { values: aaaa.values } } : {}),
					wildcard: null,
				};
			}
			if (provider.aliases === true) {
				const cname = await read(host, "CNAME");
				const target = cname === null ? null : bareName(cname.values[0]);
				if (target) {
					const own = inZone(cover.zone, target) ? await read(target) : null;
					return {
						record: null,
						wildcard: null,
						alias: {
							target,
							proxied: cname.proxied === true,
							own: own === null ? null : { values: own.values },
						},
					};
				}
			}
			const parent = host.slice(host.indexOf(".") + 1);
			if (provider.wildcards !== true || !host.includes(".") || !inZone(cover.zone, parent)) {
				return { record: null, wildcard: null };
			}
			const wildcardName = `*.${parent}`;
			const wildcard = await read(wildcardName);
			return {
				record: null,
				wildcard:
					wildcard === null
						? null
						: { name: wildcardName, values: wildcard.values, proxied: wildcard.proxied === true },
			};
		} catch (error) {
			if (error instanceof ReadSkipped) return { skipped: READ_SKIPPED };
			if (!(error instanceof DdnsProviderError)) throw error;
			// a 429 stops this credential's reads for the rest of the request: this name keeps its DNS answer too
			if (error.providerStatus === 429) return { skipped: READ_SKIPPED };
			return { record: null, wildcard: null, error: error.message };
		}
	};
};

const internalDnsCheck = {
	/**
	 * The cached results of the hosts the user may view
	 *
	 * @param   {Access}  access
	 * @returns {Promise<Array>}  [{ type, id, checked_on, names }]
	 */
	hosts: async (access) => {
		const mine = hostCheckCache.ofScope(scopeOf(access)).filter((entry) => canView(access, entry.type));
		const visible = [];
		for (const type of Object.keys(HOST_TYPES)) {
			const entries = mine.filter((entry) => entry.type === type);
			if (entries.length === 0) continue;
			const query = HOST_TYPES[type].model.query().whereIn(
				"id",
				entries.map((entry) => entry.id),
			);
			if (ownOnly(access)) query.andWhere("owner_user_id", access.token.getUserId(1));
			const ids = new Set((await query.select("id")).map((row) => row.id));
			visible.push(...entries.filter((entry) => ids.has(entry.id)));
		}
		return visible.map(publicView);
	},

	/**
	 * Checks the names of the hosts (cached for 30 s) and caches the results
	 *
	 * @param   {Access}  access
	 * @param   {Array<{ type: String, id: number }>}  hosts  1 to 50 hosts, 200 names at most across them
	 * @returns {Promise<Array>}  [{ type, id, checked_on, names }]; within the request deadline (60 s): a name not
	 *                            finished by then answers unknown (reason timeout) and its host is not cached
	 * @throws  {errs.ItemNotFoundError}  a host the user may not view or that does not exist: the whole request
	 * @throws  {errs.ValidationError}    more than 200 names
	 */
	check: async (access, hosts) => {
		// a clear (host change, restore) from here on keeps this check's results out of the cache
		const since = hostCheckCache.generation();
		const wanted = [...new Map(hosts.map((host) => [`${host.type}:${host.id}`, host])).values()];
		for (const { type, id } of wanted) {
			if (!canView(access, type)) throw new errs.ItemNotFoundError(id);
		}
		const rows = new Map();
		for (const type of Object.keys(HOST_TYPES)) {
			const ids = wanted.filter((host) => host.type === type).map((host) => host.id);
			if (ids.length === 0) continue;
			const query = HOST_TYPES[type].model.query().whereIn("id", ids);
			if (ownOnly(access)) query.andWhere("owner_user_id", access.token.getUserId(1));
			for (const row of await query) rows.set(`${type}:${row.id}`, row);
		}
		for (const { type, id } of wanted) {
			if (!rows.has(`${type}:${id}`)) throw new errs.ItemNotFoundError(id);
		}
		const nameCount = new Set([...rows.values()].flatMap(namesOf)).size;
		if (nameCount > MAX_NAMES) {
			throw new errs.ValidationError(
				`These hosts have ${nameCount} names; one check takes at most ${MAX_NAMES}: check fewer hosts at once`,
				"error.dns-check-too-many-names",
				{ values: { count: nameCount, max: MAX_NAMES } },
			);
		}

		const scope = scopeOf(access);
		const deadline = requestDeadline();
		const limit = limitConcurrency(CONCURRENCY);
		const servers = ddnsSettingsOf(effectiveEnv()).resolvers ?? [];
		const once = (task) => {
			let promise = null;
			return () => {
				promise ??= task();
				return promise;
			};
		};
		// an address that cannot be detected is an unknown address, not a failed request
		const detect = (family) => async () => {
			try {
				return await publicAddressOf(family);
			} catch (error) {
				logger.warn(`DNS check: the IPv${family} detection failed: ${error?.message}`);
				return null;
			}
		};
		const ipv4 = once(detect(4));
		const ipv6 = once(detect(6));
		const coverage = createCoverage(access, limit, deadline.signal);
		// a lookup unfinished at the deadline answers timeout, and one still waiting for its turn is not made
		const timedOut = () => ({ ok: false, code: "timeout" });
		const lookupLimited = (name, type) =>
			limit(() =>
				deadline.signal.aborted ? timedOut() : beforeDeadline(lookup(name, type, servers), deadline, timedOut),
			);
		const byName = new Map();
		const checkOnce = (name) => {
			if (!byName.has(name)) {
				const task = (async () =>
					checkName({
						name,
						publicIp: { ipv4: await ipv4(), ipv6 },
						lookup: lookupLimited,
						coverage,
						onError: (error) => logger.warn(`DNS check: ${name} failed: ${error?.message}`),
					}))();
				byName.set(
					name,
					beforeDeadline(task, deadline, () => ({ ...unknownAnswer(name, "timeout"), late: true })),
				);
			}
			return byName.get(name);
		};

		const results = new Map();
		const needed = [];
		for (const { type, id } of wanted) {
			const cached = hostCheckCache.get(type, id, scope);
			if (hostCheckCache.fresh(cached)) results.set(`${type}:${id}`, cached);
			else needed.push({ type, id, row: rows.get(`${type}:${id}`) });
		}
		await Promise.all(
			needed.map(async ({ type, id, row }) => {
				const answers = await Promise.all(namesOf(row).map(checkOnce));
				const late = answers.some((one) => one.late === true);
				const names = answers.map(({ late: _late, ...one }) => one);
				const entry = { checked_on: new Date().toISOString(), names };
				// a host with a name the deadline cut is answered, not cached
				if (!late) hostCheckCache.set(type, id, scope, { ...entry, since });
				results.set(`${type}:${id}`, { type, id, ...entry });
			}),
		);
		return wanted.map(({ type, id }) => publicView(results.get(`${type}:${id}`)));
	},

	/** Forgets a host's results (its names changed, it was deleted, enabled or disabled) */
	clearHost: (type, id) => hostCheckCache.clearHost(type, id),
};

export { createCoverage, loadZones };
export default internalDnsCheck;
