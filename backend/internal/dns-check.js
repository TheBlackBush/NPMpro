import { DdnsProviderError } from "../lib/ddns/errors.js";
import { providerFetch } from "../lib/ddns/provider-fetch.js";
import { updaterFor } from "../lib/ddns/providers/index.js";
import { ddnsSettingsOf } from "../lib/ddns/settings.js";
import { hostCheckCache } from "../lib/dns-check/host-cache.js";
import { checkName } from "../lib/dns-check/host-check.js";
import { limitConcurrency } from "../lib/dns-check/limit.js";
import { lookup } from "../lib/dns-check/lookup.js";
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

/** the zones of the credentials the user may see, with their credential ids */
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

/**
 * The provider read of one call (per user): A at the name and, when there is none, the wildcard at the direct parent
 * (Cloudflare and DigitalOcean only). null: no right, no visible covering credential, no read call, or the DNS answer
 * is already here on a provider whose answers are not the record (only Cloudflare is read always).
 */
const createCoverage = (access, limit) => {
	const manage = access.level("certificates") === "manage";
	let zones = null;
	const credentials = new Map();

	const credentialOf = async (id) => {
		if (!credentials.has(id)) credentials.set(id, dnsCredentialModel.query().findById(id));
		return await credentials.get(id);
	};

	const read = async (provider, args, type = "A") => limit(() => provider.read({ ...args, type, meta: {} }));

	return async (name, { dnsHere }) => {
		if (!manage) return null;
		zones ??= loadZones(access);
		const host = bareName(name);
		const cover = coveringZone(host, await zones, access.token.getUserId(1));
		if (cover === null || cover.credentialIds.length !== 1) return null;
		const row = await credentialOf(cover.credentialIds[0]);
		const provider = updaterFor(row?.provider);
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
		const deadline = AbortSignal.timeout(PROVIDER_DEADLINE_MS);
		const fetch = (url, options) => providerFetch(url, { ...options, secrets, deadline });
		try {
			const record = await read(provider, { zone: cover.zone, name: host, fields, fetch });
			if (record !== null)
				return { record: { values: record.values, proxied: record.proxied === true }, wildcard: null };
			if (provider.aliases === true) {
				const cname = await read(provider, { zone: cover.zone, name: host, fields, fetch }, "CNAME");
				const target = cname === null ? null : bareName(cname.values[0]);
				if (target) {
					const own = inZone(cover.zone, target)
						? await read(provider, { zone: cover.zone, name: target, fields, fetch })
						: null;
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
			const wildcard = await read(provider, { zone: cover.zone, name: wildcardName, fields, fetch });
			return {
				record: null,
				wildcard:
					wildcard === null
						? null
						: { name: wildcardName, values: wildcard.values, proxied: wildcard.proxied === true },
			};
		} catch (error) {
			if (!(error instanceof DdnsProviderError)) throw error;
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
	 * @param   {Array<{ type: String, id: number }>}  hosts  1 to 50 hosts
	 * @returns {Promise<Array>}  [{ type, id, checked_on, names }]
	 * @throws  {errs.ItemNotFoundError}  a host the user may not view or that does not exist: the whole request
	 */
	check: async (access, hosts) => {
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

		const scope = scopeOf(access);
		// a clear (host change, restore) while this runs keeps its results out of the cache
		const since = hostCheckCache.generation();
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
		const coverage = createCoverage(access, limit);
		const byName = new Map();
		const checkOnce = (name, publicIp) => {
			if (!byName.has(name)) {
				byName.set(
					name,
					checkName({
						name,
						publicIp,
						lookup: (n, type) => limit(() => lookup(n, type, servers)),
						coverage,
						onError: (error) => logger.warn(`DNS check: ${name} failed: ${error?.message}`),
					}),
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
		if (needed.length > 0) {
			const wantsNames = needed.some(({ row }) => namesOf(row).length > 0);
			const publicIp = {
				ipv4: wantsNames ? await ipv4() : null,
				ipv6,
			};
			for (const { type, id, row } of needed) {
				const names = await Promise.all(namesOf(row).map((name) => checkOnce(name, publicIp)));
				const entry = { checked_on: new Date().toISOString(), names };
				hostCheckCache.set(type, id, scope, { ...entry, since });
				results.set(`${type}:${id}`, { type, id, ...entry });
			}
		}
		return wanted.map(({ type, id }) => publicView(results.get(`${type}:${id}`)));
	},

	/** Forgets a host's results (its names changed, it was deleted, enabled or disabled) */
	clearHost: (type, id) => hostCheckCache.clearHost(type, id),
};

export default internalDnsCheck;
