import { overridesAcmeChallenge } from "../lib/acme-challenge.js";
import { scrubSecrets } from "../lib/ddns/errors.js";
import { providerFetch } from "../lib/ddns/provider-fetch.js";
import { updaterFor } from "../lib/ddns/providers/index.js";
import { sameAddress } from "../lib/ddns/providers/record-common.js";
import { limitConcurrency } from "../lib/dns-check/limit.js";
import { isPublicAddress, probeReach } from "../lib/dns-check/reach-probe.js";
import { requestDeadline } from "../lib/dns-check/timing.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { coveringZone } from "../lib/dns-domain-match.js";
import errs from "../lib/error.js";
import { global as logger } from "../logger.js";
import dnsCredentialModel from "../models/dns_credential.js";
import internalAuditLog from "./audit-log.js";
import { publicAddressOf, writeRecordNow } from "./ddns.js";
import internalDdnsRecord, { auditMeta, HOST_MODELS, isManaged, managedRows, recordLock } from "./ddns-record.js";
import { createCoverage, loadZones } from "./dns-check.js";
import internalDnsCredential from "./dns-credential.js";

// The host record option (D26, D28): a name of a proxy, redirection or 404 host that the user ticked gets its own
// A (and, with the IPv6 box, AAAA) record at the provider of the one visible credential that covers it, kept current
// by the dynamic DNS engine as a record row with host_type, host_id and origin. Nothing happens for a name that was not
// ticked, and a host with no rows and no ticks is never looked at further (no provider call, no probe, no detection).
//
// A name's state: off (no row), unavailable (a check refused the tick: reason), covered (a wildcard or a manual
// record already serves it: no row), pending (also while the host's job works on it), ok, failed (the engine's states,
// or a provider read that failed), exists (the name already holds another record: nothing written until Adopt and
// update or Leave alone), paused (the host is disabled) and orphan (a delete at the provider failed or found another
// value: the row stays until it is deleted again or forgotten).
//
// The host always saves at once: a save never probes and never calls a provider. It refuses what it can tell without
// the provider (the name, the rights, the public address, the reach: a probe of the last 10 minutes or the user's
// confirmation) and leaves the provider work (reads, the row, the engine's write, deletes) to a job that runs after
// the answer, one per host at a time; its results are read through statesOf.
//
// Never overwrite, never delete what NPMpro did not create: a record is adopted only when it already holds the wanted
// address in every family or the user pressed Adopt and update; a created row is create-only until its first write
// (the engine turns it into "exists" when a record appeared at the name); a provider delete runs only for a row with
// origin "created", only for the addresses it wrote. A row changes only under its record lock, and no record lock is
// taken while an owner or CA lock is held (a row is inserted under the owner and name locks, then written under the
// record lock).

const SECTIONS = {
	proxy_host: "proxy_hosts",
	redirection_host: "redirection_hosts",
	dead_host: "dead_hosts",
};

// a new record's TTL (R12): 300 s, raised to the provider's minimum; an existing record keeps its own
const NEW_TTL = 300;
// a reach probe result of the window counts for the save that follows within this time
const REACH_FRESH_MS = 10 * 60_000;
const MAX_REACH_ENTRIES = 500;
const CONCURRENCY = 4;

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const PLAIN_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`, "u");

const REASONS = {
	wildcard: [
		"error.host-dns-wildcard",
		"A wildcard name: use a zone-wide wildcard record under Certificates & DNS, Dynamic DNS",
	],
	pattern: ["error.host-dns-pattern", "A regular expression name gets no DNS record"],
	noRight: ["error.host-dns-no-right", "Creating a DNS record needs the right to manage certificates"],
	noCredential: ["error.host-dns-no-credential", "No saved credential covers this name"],
	manyCredentials: ["error.host-dns-many-credentials", "More than one credential covers it"],
	unsupported: [
		"error.host-dns-provider-unsupported",
		"The provider of this credential cannot create and delete host records",
	],
	noAddress: ["error.host-dns-no-public-address", "No public address found"],
	hostDisabled: ["error.host-dns-host-disabled", "The host is disabled: enable it to create its DNS records"],
	nameTaken: ["error.host-dns-name-taken", "Another dynamic DNS record already keeps this name"],
	reach: [
		"error.host-dns-reach-unconfirmed",
		"Confirm that you checked from outside that ports 80 and 443 reach this server",
	],
	readFailed: ["error.host-dns-read-failed", "The record could not be read at the provider"],
	readSkipped: ["error.host-dns-read-skipped", "The provider was not read now (too many reads): save again later"],
	coveredByRecord: ["host-dns.covered-by-record", "Kept updated by the Dynamic DNS record"],
	coveredByWildcard: ["host-dns.covered-by-wildcard", "Covered by a wildcard record"],
	coveredByOther: ["host-dns.covered-by-other", "Covered by another record"],
};

const OTHER_OWNER = ["host-dns.other-owner", "Managed by another user"];
const CHANGED_AT_PROVIDER = "The record at the provider holds another value now; NPMpro left it there";

const FAMILIES = [
	["A", "last_ipv4"],
	["AAAA", "last_ipv6"],
];

const hostSection = (hostType) => {
	if (!Object.hasOwn(SECTIONS, hostType)) throw new errs.InternalValidationError(`Unknown host type ${hostType}`);
	return SECTIONS[hostType];
};

const userIdOf = (access) => access.token.getUserId(1);
const ownOnly = (access) => access.visibility !== "all";
const hostKey = (hostType, hostId) => `${hostType}:${hostId}`;

const namesOf = (host) => [
	...new Set((Array.isArray(host?.domain_names) ? host.domain_names : []).map((name) => String(name).toLowerCase())),
];

/** A name no record is made for: a wildcard or a regular expression (or anything else that is no plain name) */
const nameRefusal = (name) => {
	if (name.includes("*")) return REASONS.wildcard;
	if (name.length > 253 || !PLAIN_NAME.test(name)) return REASONS.pattern;
	return null;
};

const answer = (name, state, extra = {}) => ({
	name,
	state,
	origin: null,
	record_id: null,
	ipv6: null,
	message: null,
	reason: null,
	covered_by: null,
	found: null,
	adopt_allowed: null,
	...extra,
});

const refused = (name, state, [reason, message], extra = {}) => answer(name, state, { reason, message, ...extra });

/** What a row's name state is: an orphan, a name that holds another record, a paused host, else the engine's state */
const stateOfRow = (row) => {
	if (row.meta?.orphan === true) return "orphan";
	if (row.meta?.exists) return "exists";
	if (row.meta?.paused_by_host === true || row.enabled === false) return "paused";
	return ["pending", "ok", "failed"].includes(row.state) ? row.state : "pending";
};

const existsText = (found) =>
	found
		.map(({ type, values }) => `${type} ${values.join(", ")}`)
		.join(" and ")
		.concat(" already exists here");

const rowBase = (row) => ({ origin: row.origin ?? null, record_id: row.id, ipv6: row.ip_version === "both" });

/**
 * A row as a name's state. A row of a credential the user cannot see shows "Managed by another user", without the
 * provider's message or the values found.
 */
const answerOfRow = (row, access) => {
	const state = stateOfRow(row);
	const base = rowBase(row);
	if (ownOnly(access) && row.owner_user_id !== userIdOf(access)) {
		return refused(row.name, state, OTHER_OWNER, base);
	}
	if (state === "exists") {
		const { found, adopt_allowed: adoptAllowed } = row.meta.exists;
		return answer(row.name, state, {
			...base,
			found,
			adopt_allowed: adoptAllowed === true,
			reason: adoptAllowed === true ? "host-dns.exists" : "host-dns.exists-remove-first",
			message:
				adoptAllowed === true ? existsText(found) : `${existsText(found)}: remove it at the provider first`,
		});
	}
	return answer(row.name, state, { ...base, message: ["failed", "orphan"].includes(state) ? row.error : null });
};

/**
 * One record set at a name compared with the wanted address: none, equal, different, or multi (more than one value,
 * which the engine never writes)
 */
const judge = (record, wanted) => {
	if (record === null || record === undefined) return "none";
	if ((record.values?.length ?? 0) !== 1) return "multi";
	return sameAddress(record.values[0], wanted) ? "equal" : "different";
};

/**
 * What a tick does with what the coverage read found at the name: create (nothing there), adopt (every wanted family
 * holds the wanted address), or exists (anything else: adopt_allowed unless a set has more than one value or the name
 * is a CNAME; a set present for one family only is exists too)
 *
 * @param   {Object}  read  the coverage read: { record, aaaa, alias }
 */
const decide = (read, { ipv4, ipv6 }) => {
	if (read.alias) {
		return { kind: "exists", adopt_allowed: false, found: [{ type: "CNAME", values: [read.alias.target] }] };
	}
	const units = [{ type: "A", record: read.record, wanted: ipv4 }];
	if (ipv6 !== null) units.push({ type: "AAAA", record: read.aaaa, wanted: ipv6 });
	const verdicts = units.map((unit) => ({ ...unit, verdict: judge(unit.record, unit.wanted) }));
	if (verdicts.every((unit) => unit.verdict === "none")) return { kind: "create" };
	if (verdicts.every((unit) => unit.verdict === "equal")) return { kind: "adopt" };
	const found = verdicts
		.filter((unit) => unit.verdict !== "none")
		.map((unit) => ({ type: unit.type, values: unit.record.values.map(String) }));
	return { kind: "exists", adopt_allowed: !verdicts.some((unit) => unit.verdict === "multi"), found };
};

const isSupported = (provider) =>
	provider !== null &&
	typeof provider?.read === "function" &&
	typeof provider?.write === "function" &&
	typeof provider?.remove === "function" &&
	provider.zoneless !== true;

const defaultFetchFor = (secrets, deadline) => (url, options) => providerFetch(url, { ...options, secrets, deadline });

/**
 * @param   {Object}    [deps]
 * @param   {Function}  [deps.providerFor]    (credential provider) -> the provider with read, write and remove, or null
 * @param   {Function}  [deps.publicAddress]  (family) -> the detector's confirmed public address, or null
 * @param   {Function}  [deps.probe]          probeReach
 * @param   {Function}  [deps.writeRecord]    (id) -> the engine's run of one record now (updateRecord)
 * @param   {Function}  [deps.fetchFor]       (secrets, deadline) -> the guarded fetch handed to a provider
 * @param   {Function}  [deps.hostExists]     (hostType, id) -> whether the host row still exists
 * @param   {Object}    [deps.clock]          { now() } in ms
 * @param   {Object}    [deps.log]            { warn() }
 */
const createHostDnsRecords = ({
	providerFor = updaterFor,
	publicAddress = publicAddressOf,
	probe = probeReach,
	writeRecord = writeRecordNow,
	fetchFor = defaultFetchFor,
	hostExists = async (hostType, id) => Boolean(await HOST_MODELS[hostType].query().findById(id).select("id")),
	clock = { now: () => Date.now() },
	log = logger,
} = {}) => {
	const reachCache = new Map();
	// the host jobs: the tail of each host's chain, the names a job works on (counted), and the last job's results
	// for names that got no row (covered, unavailable, failed)
	const chains = new Map();
	const working = new Map();
	const results = new Map();

	const openCredentialRow = (credential) => {
		const fields = credentialFields(internalDnsCredential.openValues(credential));
		return { fields, secrets: secretValuesOf(credential.provider, fields) };
	};

	/** One detection per call, shared by its names; only a public address counts */
	const addressesOnce = () => {
		const once = new Map();
		const of = (family) => {
			if (!once.has(family)) {
				once.set(
					family,
					(async () => {
						try {
							const address = await publicAddress(family);
							return isPublicAddress(address) ? address : null;
						} catch (error) {
							log?.warn?.(`Host DNS records: the IPv${family} detection failed: ${error?.message}`);
							return null;
						}
					})(),
				);
			}
			return once.get(family);
		};
		return { ipv4: () => of(4), ipv6: () => of(6) };
	};

	/** The provider reads of one job or plan: the host check's reader with its read cap, 429 stop and deadline */
	const readerFor = (access) => {
		const deadline = requestDeadline();
		let zones = null;
		return {
			coverage: createCoverage(access, limitConcurrency(CONCURRENCY), deadline.signal, { providerFor, fetchFor }),
			zones: () => {
				zones ??= loadZones(access);
				return zones;
			},
			addresses: addressesOnce(),
		};
	};

	/** A covering row the user may not see is named to nobody: "covered by another record" */
	const coveredByRow = (access, row, reason) =>
		ownOnly(access) && row.owner_user_id !== userIdOf(access)
			? { reason: REASONS.coveredByOther, covered_by: null }
			: { reason, covered_by: row.name };

	/**
	 * The checks and the coverage of one name for one host (spec Feature 5, Handle and Covered); reads the provider
	 * through the shared reader
	 *
	 * @returns {Promise<Object>}  { name, available, reason, message, covered_by, credential, zone, provider_label,
	 *          address, ipv6_address, ttl, proxied_allowed, existing, failed } and, internally, read, provider,
	 *          credentialRow, withIpv6
	 */
	const inspect = async (access, { hostType, hostId, name, ipv6, reader }) => {
		const plan = {
			name,
			available: false,
			reason: null,
			message: null,
			covered_by: null,
			credential: null,
			zone: null,
			provider_label: null,
			address: null,
			ipv6_address: null,
			ttl: null,
			proxied_allowed: false,
			existing: null,
			failed: false,
		};
		const no = ([reason, message], extra = {}) => ({ ...plan, reason, message, ...extra });
		const refusal = nameRefusal(name);
		if (refusal !== null) return no(refusal);
		if (access.level("certificates") !== "manage") return no(REASONS.noRight);
		const cover = coveringZone(name, await reader.zones(), userIdOf(access));
		if (cover === null) return no(REASONS.noCredential);
		if (cover.credentialIds.length !== 1) return no(REASONS.manyCredentials);
		const credentialRow = await dnsCredentialModel.query().findById(cover.credentialIds[0]);
		if (!credentialRow) return no(REASONS.noCredential);
		const provider = providerFor(credentialRow.provider);
		Object.assign(plan, {
			credential: { id: credentialRow.id, name: credentialRow.name },
			zone: cover.zone,
			provider_label: provider?.label ?? credentialRow.provider,
		});
		if (!isSupported(provider)) return no(REASONS.unsupported);
		Object.assign(plan, {
			ttl: Math.max(NEW_TTL, Number.isInteger(provider.minTtl) ? provider.minTtl : 0),
			proxied_allowed: provider.proxied === true,
		});
		const ipv4 = await reader.addresses.ipv4();
		if (ipv4 === null) return no(REASONS.noAddress);
		plan.address = ipv4;
		plan.ipv6_address = await reader.addresses.ipv6();

		// a record already keeps the name: a manual one covers it, another host's takes it
		const taken = await managedRows.byName(name);
		if (taken !== null && !isManaged(taken)) {
			const { reason, covered_by: coveredBy } = coveredByRow(access, taken, REASONS.coveredByRecord);
			return no(reason, { covered_by: coveredBy ?? "" });
		}
		if (taken !== null && (taken.host_type !== hostType || taken.host_id !== hostId)) return no(REASONS.nameTaken);
		const manualWildcard = await managedRows.byName(`*.${name.slice(name.indexOf(".") + 1)}`);
		if (manualWildcard !== null) {
			const { reason, covered_by: coveredBy } = coveredByRow(access, manualWildcard, REASONS.coveredByWildcard);
			return no([reason[0], coveredBy ? `Covered by ${coveredBy}` : reason[1]], { covered_by: coveredBy ?? "" });
		}

		const withIpv6 = ipv6 === true && plan.ipv6_address !== null;
		const read = await reader.coverage(name, { dnsHere: false, withAaaa: withIpv6 });
		if (read === null) return no(REASONS.unsupported);
		if (read.skipped) return no(REASONS.readSkipped, { failed: true });
		if (read.error) return no([REASONS.readFailed[0], read.error], { failed: true });
		if (read.wildcard) {
			return no([REASONS.coveredByWildcard[0], `Covered by ${read.wildcard.name}`], {
				covered_by: read.wildcard.name,
			});
		}
		const existing = [
			["A", read.record?.values],
			["AAAA", read.aaaa?.values],
			["CNAME", read.alias ? [read.alias.target] : undefined],
		]
			.filter(([, values]) => Array.isArray(values))
			.map(([type, values]) => ({ type, values: values.map(String) }));
		return {
			...plan,
			available: true,
			existing: existing.length > 0 ? existing : null,
			internal: { read, provider, credentialRow, withIpv6 },
		};
	};

	const publicPlan = ({ internal: _internal, failed: _failed, ...plan }) => ({
		...plan,
		covered_by: plan.covered_by === "" ? null : plan.covered_by,
	});

	const overrides = (host) => (host?.locations ?? []).some(overridesAcmeChallenge);

	const remembered = (name, address) => {
		const entry = reachCache.get(`${name}|${address}`);
		return entry && clock.now() - entry.at < REACH_FRESH_MS ? entry.outcome : null;
	};

	const remember = (name, address, outcome) => {
		if (reachCache.size >= MAX_REACH_ENTRIES) reachCache.delete(reachCache.keys().next().value);
		reachCache.set(`${name}|${address}`, { at: clock.now(), outcome });
	};

	/** The row of a host the user may see, with the host's manage right; 404 otherwise */
	const hostOf = async (access, hostType, hostId) => {
		access.can(`${hostSection(hostType)}:manage`);
		const host = await HOST_MODELS[hostType].query().findById(hostId);
		if (!host || (ownOnly(access) && host.owner_user_id !== userIdOf(access))) {
			throw new errs.ItemNotFoundError(hostId);
		}
		return host;
	};

	const audit = (access, action, row, extra = {}) =>
		internalAuditLog.add(access, {
			action,
			object_type: "ddns-record",
			object_id: row.id,
			meta: { ...auditMeta(row, null), dns_credential_id: row.dns_credential_id, ...extra },
		});

	/** Runs the engine for a row now; its failures stay on the row (a refusal, such as no address, leaves it pending) */
	const writeNow = async (id) => {
		try {
			await writeRecord(id);
		} catch (error) {
			log?.warn?.(`Host DNS records: record ${id} was not written now: ${error?.message}`);
		}
	};

	/**
	 * Deletes, at the provider, each address a created row wrote, every family with its own value (a provider's
	 * record id of one family is never handed to the other: none is passed). A deleted address is cleared on the row
	 * at once, so a later try deletes only what is left; an address the provider holds another value for is kept
	 * there (and on the row). The row's lock is held by the caller.
	 *
	 * @returns {Promise<{ results: Array<{ type, value, outcome }>, error: String|null }>}  outcome gone, changed or
	 *          failed; error the scrubbed message of the first failure (the other families are not tried after it)
	 */
	const deleteWritten = async (row) => {
		const units = FAMILIES.filter(([, key]) => typeof row[key] === "string" && row[key] !== "");
		const done = [];
		if (units.length === 0) return { results: done, error: null };
		const credentialRow = await dnsCredentialModel.query().findById(row.dns_credential_id);
		const provider = credentialRow ? providerFor(credentialRow.provider) : null;
		if (!isSupported(provider)) {
			return { results: done, error: "The DNS credential of this record cannot delete it" };
		}
		const { fields, secrets } = openCredentialRow(credentialRow);
		const fetch = fetchFor(secrets);
		const { record_id: _recordId, ...meta } = row.meta ?? {};
		for (const [type, key] of units) {
			const value = row[key];
			let removed;
			try {
				removed = await provider.remove({ zone: row.zone, name: row.name, type, value, fields, fetch, meta });
			} catch (error) {
				done.push({ type, value, outcome: "failed" });
				return { results: done, error: scrubSecrets(error?.message ?? "The delete failed", secrets) };
			}
			const outcome = removed?.changed === true ? "changed" : "gone";
			done.push({ type, value, outcome });
			if (outcome === "gone") await managedRows.patch(row.id, { [key]: null });
		}
		return { results: done, error: null };
	};

	/** The orphan patch of a row whose delete failed or found another value: kept, never run by the engine */
	const orphanPatch = (row, message, note) => {
		const { paused_by_host: _paused, error_i18n: _key, error_values: _values, ...meta } = row.meta ?? {};
		return {
			enabled: false,
			state: "failed",
			error: message,
			failures: 0,
			next_try_on: null,
			meta: { ...meta, orphan: true, ...(note ? { orphan_note: note } : {}) },
		};
	};

	/**
	 * Deletes a created row's records at the provider and settles the row: removed when every address is gone,
	 * else an orphan (a failure, or another value at the provider: "changed", which is kept there). Audited with
	 * every result. The row's lock is held by the caller.
	 *
	 * @returns {Promise<boolean>}  whether the row was removed
	 */
	const settleDelete = async (access, row, action) => {
		const { results: done, error } = await deleteWritten(row);
		const changed = done.some((one) => one.outcome === "changed");
		if (error !== null || changed) {
			const message = error ?? CHANGED_AT_PROVIDER;
			await managedRows.patch(row.id, orphanPatch(row, message, error === null ? "changed" : null));
			await audit(access, "orphaned", row, { results: done, error: message });
			return false;
		}
		await managedRows.remove(row.id);
		await audit(access, action, row, { at_provider: true, results: done });
		return true;
	};

	/**
	 * Releases a row (an unticked or removed name, a deleted host): a created row's records are deleted at the
	 * provider first (only the addresses it wrote); an adopted one, and a name that held another record, is left
	 * there. A failed or refused delete keeps the row as an orphan, never stopping the host's change. Runs under the
	 * row's lock, the provider work as the system (the credential, whoever owns it), audited with the user.
	 */
	const release = (access, id) =>
		recordLock(id, async () => {
			const row = await managedRows.get(id);
			if (!row) return;
			if (row.origin === "created") {
				await settleDelete(access, row, "removed");
				return;
			}
			await managedRows.remove(id);
			await audit(access, "removed", row, { at_provider: false });
		});

	/** An orphan of this host whose name is ticked again: its record is NPMpro's, so the row is simply resumed */
	const resume = (access, row) =>
		recordLock(row.id, async () => {
			const current = await managedRows.get(row.id);
			if (current?.meta?.orphan !== true) return;
			const { orphan: _orphan, orphan_note: _note, ...meta } = current.meta;
			await managedRows.patch(row.id, {
				enabled: true,
				state: "pending",
				error: null,
				failures: 0,
				next_try_on: null,
				meta,
			});
			await audit(access, "resumed", row);
		});

	/**
	 * The job's part of a tick: the checks that read, the coverage read, then the row (and the engine's write)
	 *
	 * @returns {Promise<Object|null>}  the name's answer when no row was made, else null
	 */
	const tick = async (access, { hostType, host, entry, reach, reader }) => {
		const { name } = entry;
		const plan = await inspect(access, { hostType, hostId: host.id, name, ipv6: entry.ipv6, reader });
		if (plan.covered_by !== null) {
			return answer(name, "covered", {
				reason: plan.reason,
				message: plan.message,
				covered_by: plan.covered_by === "" ? null : plan.covered_by,
			});
		}
		if (!plan.available) {
			return answer(name, plan.failed ? "failed" : "unavailable", { reason: plan.reason, message: plan.message });
		}
		const { read, provider, credentialRow, withIpv6 } = plan.internal;
		const ipv6 = withIpv6 ? plan.ipv6_address : null;
		const verdict = decide(read, { ipv4: plan.address, ipv6 });
		const meta = {
			reach: { ...reach, checked_on: new Date(clock.now()).toISOString(), user_id: userIdOf(access) },
		};
		const values = {
			owner_user_id: credentialRow.owner_user_id,
			dns_credential_id: credentialRow.id,
			provider: provider.id,
			name,
			zone: plan.zone,
			kind: "address",
			target: null,
			ip_version: ipv6 === null ? "ipv4" : "both",
			ipv6_suffix: null,
			ttl: null,
			failures: 0,
			host_type: hostType,
			host_id: host.id,
		};
		if (verdict.kind === "create") {
			Object.assign(values, { origin: "created", enabled: true, state: "pending", ttl: plan.ttl });
			// only ever created: a record that appears at the name before the first write makes the row "exists"
			meta.create_only = true;
			// Cloudflare's Proxied box is used once, by the create (R13); a later write never changes the flag
			if (entry.proxied === true && provider.proxied === true) meta.proxied_on_create = true;
		} else if (verdict.kind === "adopt") {
			Object.assign(values, {
				origin: "adopted",
				enabled: true,
				state: "ok",
				last_ipv4: plan.address,
				last_ipv6: ipv6,
				last_checked_on: new Date(clock.now()),
			});
			if (typeof read.record?.proxied === "boolean") meta.proxied_a = read.record.proxied;
		} else {
			Object.assign(values, { origin: null, enabled: false, state: "disabled" });
			meta.exists = { found: verdict.found, adopt_allowed: verdict.adopt_allowed };
		}
		values.meta = meta;

		// a host deleted while this job ran gets nothing (its delete job comes after this one)
		if (!(await hostExists(hostType, host.id))) return null;
		let row;
		try {
			row = await managedRows.insert(values);
		} catch (error) {
			if (error instanceof errs.ValidationError || error instanceof errs.ItemNotFoundError) {
				return refused(name, "unavailable", REASONS.nameTaken);
			}
			throw error;
		}
		if (verdict.kind === "create") {
			await audit(access, "created", row);
			if (await hostExists(hostType, host.id)) await writeNow(row.id);
		} else if (verdict.kind === "adopt") {
			await audit(access, "adopted", row);
		}
		return null;
	};

	/** Runs job after the host's earlier jobs; the names it works on show pending until it ends */
	const schedule = (key, names, job) => {
		const counts = working.get(key) ?? new Map();
		working.set(key, counts);
		for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
		const tail = (chains.get(key) ?? Promise.resolve())
			.then(job)
			.catch((error) => log?.warn?.(`Host DNS records: the job of ${key} failed: ${error?.message}`))
			.finally(() => {
				for (const name of names) {
					const left = (counts.get(name) ?? 1) - 1;
					if (left > 0) counts.set(name, left);
					else counts.delete(name);
				}
				if (chains.get(key) === tail) chains.delete(key);
			});
		chains.set(key, tail);
	};

	const resultsOf = (key) => {
		if (!results.has(key)) results.set(key, new Map());
		return results.get(key);
	};

	/** The name states of a host: its names in order, then rows of names it no longer has (orphans) */
	const statesOf = async (access, hostType, host, preloaded) => {
		const key = hostKey(hostType, host.id);
		const rows = preloaded ?? (await managedRows.ofHost(hostType, host.id));
		const names = namesOf(host);
		const busy = working.get(key) ?? new Map();
		const last = results.get(key) ?? new Map();
		const list = names.map((name) => {
			const row = rows.find((one) => one.name === name);
			if (busy.has(name)) return answer(name, "pending", row ? rowBase(row) : {});
			if (last.has(name)) return last.get(name);
			return row ? answerOfRow(row, access) : answer(name, "off");
		});
		for (const row of rows) if (!names.includes(row.name)) list.push(answerOfRow(row, access));
		return list;
	};

	const hasOption = async (hostType, host) => {
		const key = hostKey(hostType, host.id);
		if ((working.get(key)?.size ?? 0) > 0 || (results.get(key)?.size ?? 0) > 0) return true;
		return (await managedRows.ofHost(hostType, host.id)).length > 0;
	};

	const dedupe = (wanted) => {
		const byName = new Map();
		for (const entry of wanted) {
			const name = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : "";
			if (name !== "" && !byName.has(name)) byName.set(name, { ...entry, name });
		}
		return byName;
	};

	/** The exists row of a host the user may manage; for Adopt and update and Leave alone */
	const existsRowOf = async (access, id) => {
		const row = await managedRows.get(id);
		if (!row || !isManaged(row)) throw new errs.ItemNotFoundError(id);
		await hostOf(access, row.host_type, row.host_id);
		return row;
	};

	/**
	 * The part of a tick a save decides at once, without the provider: the name, the rights, the host, the public
	 * address and the reach (a probe of the last 10 minutes or the user's confirmation). Never probes.
	 *
	 * @returns {Promise<{ refusal: Object|null, reach: Object|null }>}
	 */
	const precheck = async (access, { host, entry, addresses }) => {
		const { name } = entry;
		const refusal = nameRefusal(name);
		if (refusal !== null) return { refusal: refused(name, "unavailable", refusal) };
		if (access.level("certificates") !== "manage") {
			return { refusal: refused(name, "unavailable", REASONS.noRight) };
		}
		if (host.enabled === false) return { refusal: refused(name, "unavailable", REASONS.hostDisabled) };
		const address = await addresses.ipv4();
		if (address === null) return { refusal: refused(name, "unavailable", REASONS.noAddress) };
		const probed = remembered(name, address);
		const confirmed = entry.reach_confirmed === true;
		if (!confirmed && probed?.result !== "reachable") {
			return { refusal: refused(name, "unavailable", REASONS.reach, { reach: probed }) };
		}
		return {
			refusal: null,
			reach: {
				result: probed?.result ?? null,
				port: probed?.port ?? null,
				detail: probed?.detail ?? null,
				confirmed,
			},
		};
	};

	return {
		/**
		 * The checks and the coverage of a host's names, for the DNS card (reads the provider; the route's caller
		 * checks the host type's right)
		 *
		 * @param   {Access}  access
		 * @param   {{ hostType: String, host: Object, names?: String[] }}  options  host: the saved row or the form's
		 *          values (domain_names, id when saved); names: those of the host to plan, all by default
		 * @returns {Promise<Object[]>}  [{ name, available, reason, message, covered_by, credential, zone,
		 *          provider_label, address, ipv6_address, ttl, proxied_allowed, existing }]
		 */
		planNames: async (access, { hostType, host, names }) => {
			access.can(`${hostSection(hostType)}:view`);
			const reader = readerFor(access);
			const list = Array.isArray(names) ? names.map((name) => String(name).toLowerCase()) : namesOf(host);
			const plans = [];
			for (const name of [...new Set(list)]) {
				plans.push(publicPlan(await inspect(access, { hostType, hostId: host?.id, name, ipv6: true, reader })));
			}
			return plans;
		},

		/**
		 * The plan of a host's names for the DNS card (POST /nginx/dns-check/plan): read only. One entry per name as
		 * planNames, plus the public addresses as this server knows them (detected when unknown) and whether the saved
		 * host is disabled. A host that is not saved yet is planned by its type alone.
		 *
		 * @param   {Access}  access
		 * @param   {{ hostType: String, hostId?: Number, names: String[] }}  options
		 * @returns {Promise<{ address: String|null, ipv6_address: String|null, host_disabled: Boolean, names: Object[] }>}
		 */
		planHost: async (access, { hostType, hostId, names }) => {
			access.can(`${hostSection(hostType)}:view`);
			let host = null;
			if (hostId !== undefined && hostId !== null) {
				host = await HOST_MODELS[hostType].query().findById(hostId);
				if (!host || (ownOnly(access) && host.owner_user_id !== userIdOf(access))) {
					throw new errs.ItemNotFoundError(hostId);
				}
			}
			const reader = readerFor(access);
			const plans = [];
			for (const name of [...new Set((names ?? []).map((one) => String(one).toLowerCase()))]) {
				plans.push(publicPlan(await inspect(access, { hostType, hostId: host?.id, name, ipv6: true, reader })));
			}
			return {
				address: await reader.addresses.ipv4(),
				ipv6_address: await reader.addresses.ipv6(),
				host_disabled: host !== null && host.enabled === false,
				names: plans,
			};
		},

		/**
		 * The host of a reach probe: the saved row (with its locations) of a host the user may manage; 404 otherwise
		 *
		 * @returns {Promise<Object>}
		 */
		hostFor: async (access, { hostType, hostId }) => {
			const host = await hostOf(access, hostType, hostId);
			if (hostType !== "proxy_host") return host;
			return await HOST_MODELS[hostType].query().findById(hostId).withGraphFetched("locations");
		},

		/**
		 * The reach probe of one name (POST /nginx/dns-check/reach): to the confirmed public IPv4 only; the result is
		 * kept for 10 minutes, for the save that follows
		 *
		 * @returns {Promise<{ result, port, detail, address }>}
		 */
		reach: async (access, { hostType, host, name }) => {
			access.can(`${hostSection(hostType)}:manage`);
			const plain = String(name ?? "").toLowerCase();
			if (nameRefusal(plain) !== null) throw new errs.ValidationError(REASONS.pattern[1], REASONS.pattern[0]);
			const address = await addressesOnce().ipv4();
			const outcome = await probe({ name: plain, address, overridesChallenge: overrides(host) });
			const done = { result: outcome.result, port: outcome.port ?? null, detail: outcome.detail ?? null };
			if (address !== null) remember(plain, address, done);
			return { ...done, address };
		},

		/**
		 * After a host's create or update. Answers at once: it never probes and never calls a provider. The ticks
		 * refused without the provider answer now; the provider work (the releases of unticked or lost names, the
		 * reads and rows of new ticks, the engine's write) runs afterwards as the host's job (idle() waits for it),
		 * and its names show pending until it ends. A host with no rows and no ticks is not looked at further.
		 *
		 * @param   {Access}  access  the user (rights of a tick; the audit)
		 * @param   {Object}  options
		 * @param   {String}  options.hostType   proxy_host, redirection_host or dead_host
		 * @param   {Object}  [options.hostBefore]  the host before the save (null for a create); not read: the host's
		 *          rows tell what it had
		 * @param   {Object}  options.hostAfter  the saved host (id, domain_names, enabled, locations)
		 * @param   {Array|undefined}  options.wanted  the request's npmpro_dns_records ([{ name, proxied, ipv6,
		 *          reach_confirmed }]); undefined: the option is not changed (only names the host lost are released)
		 * @returns {Promise<Object[]>}  the name states ([] for a host without the option)
		 */
		applyHost: async (access, { hostType, hostAfter, wanted }) => {
			hostSection(hostType);
			const key = hostKey(hostType, hostAfter.id);
			const rows = await managedRows.ofHost(hostType, hostAfter.id);
			const ticks = Array.isArray(wanted) ? dedupe(wanted) : null;
			const busy = (working.get(key)?.size ?? 0) > 0;
			if (rows.length === 0 && !busy && (ticks === null || ticks.size === 0)) {
				results.delete(key);
				return [];
			}
			const names = namesOf(hostAfter);
			const last = resultsOf(key);
			// a save that sets the option forgets the results of names it does not tick
			if (ticks !== null) for (const name of [...last.keys()]) if (!ticks.has(name)) last.delete(name);
			// the ticks of names without a row are checked now, without the provider; a refusal answers at once
			const checked = new Map();
			const addresses = addressesOnce();
			for (const entry of ticks?.values() ?? []) {
				if (!names.includes(entry.name)) continue;
				const row = rows.find((one) => one.name === entry.name);
				if (row) continue;
				const check = await precheck(access, { host: hostAfter, entry, addresses });
				checked.set(entry.name, check);
				if (check.refusal === null) last.delete(entry.name);
				else last.set(entry.name, check.refusal);
			}
			const releasing = rows
				.filter((row) => !names.includes(row.name) || (ticks !== null && !ticks.has(row.name)))
				.filter((row) => row.meta?.orphan !== true)
				.map((row) => row.name);
			const ticking = [...checked].filter(([, check]) => check.refusal === null).map(([name]) => name);
			const resuming = rows
				.filter((row) => row.meta?.orphan === true && ticks?.has(row.name) && names.includes(row.name))
				.map((row) => row.name);
			const touched = [...new Set([...releasing, ...ticking, ...resuming])];
			if (touched.length === 0 && !busy) return await statesOf(access, hostType, hostAfter);

			// the provider work, after the host's earlier jobs: decided again on the rows as they are then
			schedule(key, touched, async () => {
				const now = await managedRows.ofHost(hostType, hostAfter.id);
				for (const row of now) {
					if (row.meta?.orphan === true) continue;
					if (names.includes(row.name) && (ticks === null || ticks.has(row.name))) continue;
					await release(access, row.id);
				}
				if (ticks === null) return;
				let reader = null;
				for (const entry of ticks.values()) {
					if (!names.includes(entry.name)) continue;
					const row = now.find((one) => one.name === entry.name);
					if (row && row.meta?.orphan !== true) {
						resultsOf(key).delete(entry.name);
						continue;
					}
					if (row) {
						// an orphan of this host ticked again: needs the right of a tick, as a new one
						if (access.level("certificates") === "manage") {
							resultsOf(key).delete(entry.name);
							await resume(access, row);
							await writeNow(row.id);
						} else resultsOf(key).set(entry.name, refused(entry.name, "unavailable", REASONS.noRight));
						continue;
					}
					const check =
						checked.get(entry.name) ?? (await precheck(access, { host: hostAfter, entry, addresses }));
					if (check.refusal !== null) {
						resultsOf(key).set(entry.name, check.refusal);
						continue;
					}
					if (!(await hostExists(hostType, hostAfter.id))) return;
					reader ??= readerFor(access);
					const result = await tick(access, { hostType, host: hostAfter, entry, reach: check.reach, reader });
					if (result === null) resultsOf(key).delete(entry.name);
					else resultsOf(key).set(entry.name, result);
				}
			});
			return await statesOf(access, hostType, hostAfter);
		},

		/**
		 * Resolves when the host's jobs (of saves and deletes until now) have ended; for the tests and for a caller
		 * that wants the provider's results
		 */
		idle: async (hostType, hostId) => {
			const key = hostKey(hostType, hostId);
			while (chains.has(key)) await chains.get(key);
		},

		/** A disabled host keeps its records and pauses its rows (no provider call) */
		onDisable: async (access, { hostType, host }) => {
			hostSection(hostType);
			const rows = await managedRows.ofHost(hostType, host.id);
			if (rows.length === 0) return [];
			for (const row of rows) {
				if (row.origin === null || row.meta?.orphan === true || row.meta?.exists) continue;
				await recordLock(row.id, async () => {
					const current = await managedRows.get(row.id);
					if (!current) return;
					await managedRows.patch(row.id, {
						enabled: false,
						state: "disabled",
						meta: { ...current.meta, paused_by_host: true },
					});
				});
			}
			return await statesOf(access, hostType, host);
		},

		/** An enabled host resumes its paused rows: pending, written by the next cycle (no provider call) */
		onEnable: async (access, { hostType, host }) => {
			hostSection(hostType);
			const rows = await managedRows.ofHost(hostType, host.id);
			if (rows.length === 0) return [];
			for (const row of rows) {
				if (row.meta?.paused_by_host !== true) continue;
				await recordLock(row.id, async () => {
					const current = await managedRows.get(row.id);
					if (current?.meta?.paused_by_host !== true) return;
					const { paused_by_host: _paused, ...meta } = current.meta;
					await managedRows.patch(row.id, {
						enabled: true,
						state: "pending",
						failures: 0,
						next_try_on: null,
						error: null,
						meta,
					});
				});
			}
			return await statesOf(access, hostType, host);
		},

		/**
		 * A deleted host: as unticking every name (created records deleted at the provider, adopted ones released),
		 * as the host's job after the delete's answer and after any save job of the host still running or queued (which
		 * finds the host gone and makes nothing more); it releases the rows as they are when it runs. Answers the rows
		 * as they are now; the orphans it leaves are in the Dynamic DNS list.
		 */
		onDelete: async (access, { hostType, host }) => {
			hostSection(hostType);
			const key = hostKey(hostType, host.id);
			const rows = (await managedRows.ofHost(hostType, host.id)).filter((row) => row.meta?.orphan !== true);
			results.delete(key);
			// a save job still running or queued may yet insert a row: the delete job comes after it on the chain
			if (rows.length === 0 && (working.get(key)?.size ?? 0) === 0) return [];
			schedule(
				key,
				rows.map((row) => row.name),
				async () => {
					for (const row of await managedRows.ofHost(hostType, host.id)) {
						if (row.meta?.orphan !== true) await release(access, row.id);
					}
					results.delete(key);
				},
			);
			return rows.map((row) => answer(row.name, "pending", rowBase(row)));
		},

		/** The name states of a saved host (expand=dns_records); [] for a host without the option */
		statesOf: async (access, { hostType, host }) => {
			hostSection(hostType);
			return (await hasOption(hostType, host)) ? await statesOf(access, hostType, host) : [];
		},

		/**
		 * The name states of many saved hosts of one type, reading their rows in one query (the list's
		 * expand=dns_records); a host without the option gets []
		 *
		 * @returns {Promise<Map<number, Object[]>>}  by host id
		 */
		statesOfMany: async (access, { hostType, hosts }) => {
			hostSection(hostType);
			const rows = await managedRows.ofHosts(
				hostType,
				hosts.map((host) => host.id),
			);
			const answers = new Map();
			for (const host of hosts) {
				const own = rows.filter((row) => row.host_id === host.id);
				const key = hostKey(hostType, host.id);
				const active = (working.get(key)?.size ?? 0) > 0 || (results.get(key)?.size ?? 0) > 0;
				answers.set(host.id, own.length > 0 || active ? await statesOf(access, hostType, host, own) : []);
			}
			return answers;
		},

		/**
		 * Adopt and update: a name that held another single address is taken over; the engine writes the wanted
		 * address now (the old value goes into the history). Needs the host's manage right and certificates:manage
		 * with the record's credential visible.
		 */
		adopt: async (access, { id }) => {
			access.can("certificates:manage");
			await internalDdnsRecord.rowOf(access, id);
			const row = await existsRowOf(access, id);
			await recordLock(id, async () => {
				const current = await managedRows.get(id);
				if (current.meta.exists?.adopt_allowed !== true) {
					throw new errs.ValidationError(
						"Only a name that holds one other address can be adopted",
						"error.host-dns-adopt-refused",
					);
				}
				const { exists: _exists, create_only: _once, ...meta } = current.meta;
				await managedRows.patch(id, {
					origin: "adopted",
					enabled: true,
					state: "pending",
					ttl: null,
					failures: 0,
					next_try_on: null,
					error: null,
					meta,
				});
			});
			await audit(access, "adopted", { ...row, origin: "adopted" });
			await writeNow(id);
			return answerOfRow(await managedRows.get(id), access);
		},

		/** Leave alone: a name that held another record keeps it; the row goes, nothing is written. Host manage only. */
		leave: async (access, { id }) => {
			const row = await existsRowOf(access, id);
			await recordLock(id, async () => {
				const current = await managedRows.get(id);
				if (!current?.meta?.exists) {
					throw new errs.ValidationError(
						"Only a name that already holds another record can be left alone",
						"error.host-dns-leave-refused",
					);
				}
				await managedRows.remove(id);
			});
			await audit(access, "left", row);
			return answer(row.name, "off");
		},

		/** Delete at the provider again, for an orphan; certificates:manage and the record's credential visible */
		removeAtProvider: async (access, { id }) => {
			access.can("certificates:manage");
			const visible = await internalDdnsRecord.rowOf(access, id);
			if (visible.meta?.orphan !== true) {
				throw new errs.ValidationError(
					"Only a record whose delete at the provider failed can be deleted again",
					"error.ddns-not-orphan",
				);
			}
			await recordLock(id, async () => {
				const row = await managedRows.get(id);
				if (row?.meta?.orphan === true) await settleDelete(access, row, "removed");
			});
			const left = await managedRows.get(id);
			return left ? answerOfRow(left, access) : answer(visible.name, "off");
		},
	};
};

const hostDnsRecords = createHostDnsRecords();

export { createHostDnsRecords };
export default hostDnsRecords;
