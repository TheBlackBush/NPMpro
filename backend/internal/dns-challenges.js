import { certbotRunning } from "../lib/certbot.js";
import { providerFetch } from "../lib/ddns/provider-fetch.js";
import { sameValues } from "../lib/ddns/providers/challenge-common.js";
import { cleansChallenges, providerForCredential } from "../lib/ddns/providers/index.js";
import { limitConcurrency } from "../lib/dns-check/limit.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { bareName } from "../lib/dns-domain-match.js";
import errs from "../lib/error.js";
import { withRenewalLocks } from "./acme-account.js";
import internalAuditLog from "./audit-log.js";
import internalDnsCredential from "./dns-credential.js";
import internalDnsDomain from "./dns-domain.js";

// The cleanup of leftover `_acme-challenge` TXT records at a DNS provider (spec Feature 3). The list reads; the delete
// removes only what the user ticked, under every CA lock and never while a certbot run of this instance is counted.

const CONCURRENCY = 4;
const OPERATION_DEADLINE_MS = 300_000;
const ZONE_DEADLINE_MS = 60_000;
const MAX_ZONES = 100;
const RECENT_SECONDS = 600;
const PRESELECT_SECONDS = 3600;

const keyOf = ({ name, id }) => `${name}|${id ?? "set"}`;

const unsupported = () => ({ supported: false, busy: false, items: [], skipped_cnames: 0, truncated: false });

/** the credential's zones, lower case and without a wildcard, each once; at most MAX_ZONES (truncated says more) */
const zonesOf = async (row) => {
	const all = [...new Set((await internalDnsDomain.namesOf(row.id)).map(bareName).filter((name) => name !== ""))];
	return { zones: all.slice(0, MAX_ZONES), truncated: all.length > MAX_ZONES };
};

/**
 * The provider calls of one operation: the credential's secrets scrubbed, one overall deadline and, per zone, its own
 * shorter one inside it (a slow zone does not fail the others)
 */
const callerOf = (row) => {
	const fields = credentialFields(internalDnsCredential.openValues(row));
	const secrets = secretValuesOf(row.provider, fields);
	const overall = AbortSignal.timeout(OPERATION_DEADLINE_MS);
	return {
		forZone: () => {
			const deadline = AbortSignal.any([overall, AbortSignal.timeout(ZONE_DEADLINE_MS)]);
			return { fields, fetch: (url, options) => providerFetch(url, { ...options, secrets, deadline }) };
		},
	};
};

/** a failed provider call of the list as a public 400 the UI shows; the message is already scrubbed */
const failure = (error) =>
	new errs.ValidationError(error.message, "error.dns-cleanup-failed", {
		values: { message: error.message },
		cause: error,
	});

const isProviderError = (error) => error?.name === "DdnsProviderError";

/** the zone of a name: the longest zone of the credential that holds it, or null */
const zoneOfName = (zones, name) => {
	const holding = zones.filter((zone) => name.endsWith(`.${zone}`));
	return holding.length === 0 ? null : holding.reduce((best, zone) => (zone.length > best.length ? zone : best));
};

const listZone = async (provider, caller, zone) => {
	try {
		return await provider.listChallenges({ zone, ...caller.forZone() });
	} catch (error) {
		if (isProviderError(error)) throw failure(error);
		throw error;
	}
};

const ageOf = (changedOn, now) => {
	if (typeof changedOn !== "string") return null;
	const time = Date.parse(changedOn);
	return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / 1000));
};

const listItem = (item, busy, now) => {
	const age = ageOf(item.changed_on, now);
	return {
		key: item.key,
		name: item.name,
		id: item.id,
		values: item.values,
		age_seconds: age,
		recent: age !== null && age < RECENT_SECONDS,
		// no known age (a provider without a record time) is never ticked in advance
		preselected: !busy && age !== null && age > PRESELECT_SECONDS,
	};
};

const internalDnsChallenges = {
	/**
	 * @param   {Access}  access
	 * @param   {{ id: number }}  data  the credential id
	 * @returns {Promise<Object>}  { supported, busy, items, skipped_cnames, truncated, error_i18n? }
	 */
	get: async (access, { id }) => {
		access.can("certificates:manage");
		const row = await internalDnsCredential.get(access, { id });
		if (!cleansChallenges(row.provider)) return unsupported();
		const provider = providerForCredential(row.provider);
		const busy = certbotRunning() > 0;
		const { zones, truncated: tooMany } = await zonesOf(row);
		if (zones.length === 0) {
			return {
				supported: true,
				busy,
				items: [],
				skipped_cnames: 0,
				truncated: false,
				error_i18n: "error.dns-cleanup-no-domains",
			};
		}
		const caller = callerOf(row);
		const limit = limitConcurrency(CONCURRENCY);
		const lists = await Promise.all(zones.map((zone) => limit(() => listZone(provider, caller, zone))));
		const now = Date.now();
		const seen = new Set();
		const items = [];
		for (const list of lists) {
			for (const item of list.items) {
				if (seen.has(item.key)) continue;
				seen.add(item.key);
				items.push(listItem(item, busy, now));
			}
		}
		items.sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
		return {
			supported: true,
			busy,
			items,
			skipped_cnames: lists.reduce((sum, list) => sum + list.skipped_cnames, 0),
			truncated: tooMany || lists.some((list) => list.truncated === true),
		};
	},

	/**
	 * @param   {Access}  access
	 * @param   {{ id: number, items: Object[] }}  data  the credential id and the chosen items { name, id, values }
	 * @returns {Promise<{ results: Object[] }>}  one result per item, in order
	 */
	delete: async (access, { id, items: chosen }) => {
		access.can("certificates:manage");
		const row = await internalDnsCredential.get(access, { id });
		if (!cleansChallenges(row.provider)) {
			throw new errs.ValidationError("This provider cannot clean up challenge records");
		}
		// the provider lists names in lower case
		// and an item sent twice is one item
		const items = [
			...new Map(
				chosen.map((item) => {
					const named = { ...item, name: String(item.name).toLowerCase() };
					return [keyOf(named), named];
				}),
			).values(),
		];
		const busy = () =>
			new errs.ConflictError("A certificate request or renewal is running", "error.dns-cleanup-busy");
		if (certbotRunning() > 0) throw busy();
		const provider = providerForCredential(row.provider);
		const { zones } = await zonesOf(row);

		// never without the locks: a request could start beside the delete
		const results = await withRenewalLocks(
			async () => {
				// a run counted outside the locks (a plugin install, an account registration) is seen here
				if (certbotRunning() > 0) throw busy();
				return await deleteItems({ provider, caller: callerOf(row), zones, items });
			},
			{ requireLocks: true },
		);

		// names and the count only: the values are challenge tokens
		const deleted = results.filter((result) => result.result === "deleted");
		if (deleted.length > 0) {
			await internalAuditLog.add(access, {
				action: "challenges-deleted",
				object_type: "dns-credential",
				object_id: row.id,
				meta: {
					name: row.name,
					id: row.id,
					names: [...new Set(deleted.map((result) => result.name))],
					count: deleted.length,
				},
			});
		}
		return { results };
	},
};

const resultOf = (item, result, extra = {}) => ({
	key: keyOf(item),
	name: item.name,
	id: item.id ?? null,
	result,
	...extra,
});

/** lists each zone again, deletes the items still there with the same name and values, one result per item */
const deleteItems = async ({ provider, caller, zones, items }) => {
	const results = new Map();
	const byZone = new Map();
	for (const item of items) {
		const zone = zoneOfName(zones, String(item.name).toLowerCase());
		if (zone === null) {
			results.set(item, resultOf(item, "skipped", { reason: "outside" }));
			continue;
		}
		byZone.set(zone, [...(byZone.get(zone) ?? []), item]);
	}
	const limit = limitConcurrency(CONCURRENCY);
	await Promise.all(
		[...byZone].map(([zone, chosen]) =>
			limit(async () => {
				// one deadline for the zone's list and its deletes
				const call = caller.forZone();
				let current;
				try {
					current = await provider.listChallenges({ zone, ...call });
				} catch (error) {
					if (!isProviderError(error)) throw error;
					for (const item of chosen) results.set(item, resultOf(item, "failed", { message: error.message }));
					return;
				}
				const listed = new Map(current.items.map((entry) => [entry.key, entry]));
				for (const item of chosen) {
					const found = listed.get(keyOf(item));
					if (found === undefined) {
						results.set(item, resultOf(item, "gone"));
						continue;
					}
					if (!sameValues(found.values, item.values)) {
						results.set(item, resultOf(item, "skipped", { reason: "changed" }));
						continue;
					}
					results.set(item, await removeOne({ provider, call, zone, item, found }));
				}
			}),
		),
	);
	return items.map((item) => results.get(item));
};

const removeOne = async ({ provider, call, zone, item, found }) => {
	try {
		const done = await provider.removeChallenge({
			zone,
			item: { key: found.key, name: found.name, id: found.id, values: found.values },
			...call,
		});
		if (done.changed === true) return resultOf(item, "skipped", { reason: "changed" });
		return resultOf(item, done.gone === true ? "gone" : "deleted");
	} catch (error) {
		if (!isProviderError(error)) throw error;
		return resultOf(item, "failed", { message: error.message });
	}
};

export default internalDnsChallenges;
