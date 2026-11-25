import { overridesAcmeChallenge } from "../lib/acme-challenge.js";
import { DdnsProviderError, scrubSecrets } from "../lib/ddns/errors.js";
import { providerFetch } from "../lib/ddns/provider-fetch.js";
import { updaterFor } from "../lib/ddns/providers/index.js";
import { sameAddress } from "../lib/ddns/providers/record-common.js";
import { isPublicAddress, probeReach } from "../lib/dns-check/reach-probe.js";
import { credentialFields, secretValuesOf } from "../lib/dns-credential-values.js";
import { coveringZone } from "../lib/dns-domain-match.js";
import errs from "../lib/error.js";
import { global as logger } from "../logger.js";
import dnsCredentialModel from "../models/dns_credential.js";
import dnsDomainModel from "../models/dns_domain.js";
import internalAuditLog from "./audit-log.js";
import { publicAddressOf, writeRecordNow } from "./ddns.js";
import internalDdnsRecord, { auditMeta, HOST_MODELS, isManaged, managedRows, recordLock } from "./ddns-record.js";
import internalDnsCredential from "./dns-credential.js";

// The host record option (D26, D28): a name of a proxy, redirection or 404 host that the user ticked gets its own
// A (and, with the IPv6 box, AAAA) record at the provider of the one visible credential that covers it, kept current
// by the dynamic DNS engine as a record row with host_type, host_id and origin. Nothing happens for a name that was not
// ticked, and a host with no rows and no ticks is never looked at further (no provider call, no probe, no detection).
//
// A name's state: off (no row), unavailable (a hard check refused the tick: reason), covered (a wildcard or a manual
// record already serves it: no row), pending, ok, failed (the engine's states), exists (the name already holds
// another record: nothing written until Adopt and update or Leave alone), paused (the host is disabled) and orphan
// (a delete at the provider failed: the row stays until it is deleted again or forgotten).
//
// Never overwrite, never delete what NPMpro did not create: a record is adopted only when it already holds the wanted
// address or the user pressed Adopt and update, and a provider delete runs only for a row with origin "created", only
// for the address it wrote (the provider's remove refuses anything else). The DNS work runs after the host's save, one
// name at a time; a row changes only under its record lock, and no record lock is taken while an owner or CA lock is
// held (a row is inserted under the owner and name locks, then written under the record lock).

const SECTIONS = {
	proxy_host: "proxy_hosts",
	redirection_host: "redirection_hosts",
	dead_host: "dead_hosts",
};

// a new record's TTL (R12): 300 s, raised to the provider's minimum; an existing record keeps its own
const NEW_TTL = 300;
// a reach probe result the window just asked for is used by the save that follows, so the save does not wait again
const REACH_FRESH_MS = 10 * 60_000;
const MAX_REACH_ENTRIES = 500;

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
};

const OTHER_OWNER = ["host-dns.other-owner", "Managed by another user"];

const typeOfFamily = { A: "last_ipv4", AAAA: "last_ipv6" };

const hostSection = (hostType) => {
	if (!Object.hasOwn(SECTIONS, hostType)) throw new errs.InternalValidationError(`Unknown host type ${hostType}`);
	return SECTIONS[hostType];
};

const userIdOf = (access) => access.token.getUserId(1);
const ownOnly = (access) => access.visibility !== "all";

const namesOf = (host) => [
	...new Set((Array.isArray(host?.domain_names) ? host.domain_names : []).map((name) => String(name).toLowerCase())),
];

const answer = (name, state, extra = {}) => ({
	name,
	state,
	origin: null,
	record_id: null,
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

/**
 * A row as a name's state. A row of a credential the user cannot see shows "Managed by another user", without the
 * provider's message or the values found.
 */
const answerOfRow = (row, access) => {
	const state = stateOfRow(row);
	const base = { origin: row.origin ?? null, record_id: row.id };
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
 * What a tick does with what the provider holds at the name: create (nothing there), adopt (every wanted type holds
 * the wanted address, or is free), or exists (another address: adopt_allowed; more than one value or a CNAME: not)
 */
const decide = (read, { ipv4, ipv6 }) => {
	if (read.cname) {
		return { kind: "exists", adopt_allowed: false, found: [{ type: "CNAME", values: read.cname.values }] };
	}
	const units = [{ type: "A", record: read.a, wanted: ipv4 }];
	if (ipv6 !== null) units.push({ type: "AAAA", record: read.aaaa, wanted: ipv6 });
	const verdicts = units.map((unit) => ({ ...unit, verdict: judge(unit.record, unit.wanted) }));
	const found = verdicts
		.filter((unit) => unit.verdict !== "none")
		.map((unit) => ({ type: unit.type, values: unit.record.values.map(String) }));
	if (verdicts.some((unit) => unit.verdict === "multi")) return { kind: "exists", adopt_allowed: false, found };
	if (verdicts.some((unit) => unit.verdict === "different")) return { kind: "exists", adopt_allowed: true, found };
	if (verdicts.every((unit) => unit.verdict === "none")) return { kind: "create" };
	return { kind: "adopt", found };
};

const isSupported = (provider) =>
	provider !== null &&
	typeof provider?.read === "function" &&
	typeof provider?.write === "function" &&
	typeof provider?.remove === "function" &&
	provider.zoneless !== true;

const defaultMakeFetch = (secrets) => (url, options) => providerFetch(url, { ...options, secrets });

/**
 * @param   {Object}    [deps]
 * @param   {Function}  [deps.providerFor]    (credential provider) -> the provider with read, write and remove, or null
 * @param   {Function}  [deps.publicAddress]  (family) -> the detector's confirmed public address, or null
 * @param   {Function}  [deps.probe]          probeReach
 * @param   {Function}  [deps.writeRecord]    (id) -> the engine's run of one record now (updateRecord)
 * @param   {Function}  [deps.makeFetch]      (secrets) -> the guarded fetch handed to a provider
 * @param   {Object}    [deps.clock]          { now() } in ms
 * @param   {Object}    [deps.log]            { warn() }
 */
const createHostDnsRecords = ({
	providerFor = updaterFor,
	publicAddress = publicAddressOf,
	probe = probeReach,
	writeRecord = writeRecordNow,
	makeFetch = defaultMakeFetch,
	clock = { now: () => Date.now() },
	log = logger,
} = {}) => {
	const reachCache = new Map();

	const openCredentialRow = (credential) => {
		const fields = credentialFields(internalDnsCredential.openValues(credential));
		return { fields, secrets: secretValuesOf(credential.provider, fields) };
	};

	/** The zones of the credentials the user may see */
	const visibleZones = async (access) => {
		const query = dnsDomainModel
			.query()
			.joinRelated("credential")
			.select("npmpro_dns_domain.name", "npmpro_dns_domain.dns_credential_id", "credential.owner_user_id");
		if (ownOnly(access)) query.where("credential.owner_user_id", userIdOf(access));
		return (await query).map((row) => ({
			name: row.name,
			credentialId: row.dns_credential_id,
			ownerUserId: row.owner_user_id,
		}));
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

	/**
	 * The provider read of a name (the host check's coverage read): A (and AAAA with ipv6) at the name; when there is
	 * none, a CNAME at the name (providers with aliases), then the wildcard at the direct parent (providers whose
	 * wildcard reads are confirmed). A failure throws the provider's error.
	 */
	const readName = async ({ provider, zone, name, ipv6, fields, fetch }) => {
		const read = (target, type) => provider.read({ zone, name: target, type, fields, fetch, meta: {} });
		const a = await read(name, "A");
		const aaaa = ipv6 ? await read(name, "AAAA") : null;
		if (a !== null || aaaa !== null) return { a, aaaa, cname: null, wildcard: null };
		const cname = provider.aliases === true ? await read(name, "CNAME") : null;
		if (cname !== null) return { a, aaaa, cname, wildcard: null };
		const parent = name.slice(name.indexOf(".") + 1);
		const parentInZone = parent === zone || parent.endsWith(`.${zone}`);
		if (provider.wildcards !== true || !parentInZone) return { a, aaaa, cname, wildcard: null };
		const wildcardName = `*.${parent}`;
		const wildcard = await read(wildcardName, "A");
		return { a, aaaa, cname, wildcard: wildcard === null ? null : { name: wildcardName, values: wildcard.values } };
	};

	/**
	 * The hard checks and the coverage of one name for one host (spec Feature 5, Handle and Covered)
	 *
	 * @returns {Promise<Object>}  { name, available, reason, message, covered_by, credential, zone, provider_label,
	 *          address, ipv6_address, ttl, proxied_allowed, existing } and, internally, read, provider, credentialRow
	 */
	const inspect = async (access, { hostType, hostId, name, ipv6, zones, addresses }) => {
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
		};
		const no = ([reason, message], extra = {}) => ({ ...plan, reason, message, ...extra });
		if (name.includes("*")) return no(REASONS.wildcard);
		if (name.length > 253 || !PLAIN_NAME.test(name)) return no(REASONS.pattern);
		if (access.level("certificates") !== "manage") return no(REASONS.noRight);
		const cover = coveringZone(name, await zones(), userIdOf(access));
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
		const ipv4 = await addresses.ipv4();
		if (ipv4 === null) return no(REASONS.noAddress);
		plan.address = ipv4;
		plan.ipv6_address = await addresses.ipv6();

		// a record already keeps the name: a manual one covers it, another host's takes it
		const taken = await managedRows.byName(name);
		if (taken !== null && !isManaged(taken)) {
			return no(["host-dns.covered-by-record", "Kept updated by the Dynamic DNS record"], {
				covered_by: taken.name,
			});
		}
		if (taken !== null && (taken.host_type !== hostType || taken.host_id !== hostId)) return no(REASONS.nameTaken);
		const parent = name.slice(name.indexOf(".") + 1);
		const manualWildcard = await managedRows.byName(`*.${parent}`);
		if (manualWildcard !== null) {
			return no(["host-dns.covered-by-wildcard", `Covered by ${manualWildcard.name}`], {
				covered_by: manualWildcard.name,
			});
		}

		let opened;
		try {
			opened = openCredentialRow(credentialRow);
		} catch (error) {
			if (!(error instanceof errs.ValidationError)) throw error;
			return no([REASONS.readFailed[0], "The DNS credential cannot be read"]);
		}
		const withIpv6 = ipv6 === true && plan.ipv6_address !== null;
		let read;
		try {
			read = await readName({
				provider,
				zone: cover.zone,
				name,
				ipv6: withIpv6,
				fields: opened.fields,
				fetch: makeFetch(opened.secrets),
			});
		} catch (error) {
			if (!(error instanceof DdnsProviderError)) throw error;
			return no([REASONS.readFailed[0], scrubSecrets(error.message, opened.secrets)]);
		}
		if (read.wildcard !== null) {
			return no(["host-dns.covered-by-wildcard", `Covered by ${read.wildcard.name}`], {
				covered_by: read.wildcard.name,
			});
		}
		const existing = [
			["A", read.a],
			["AAAA", read.aaaa],
			["CNAME", read.cname],
		]
			.filter(([, record]) => record !== null)
			.map(([type, record]) => ({ type, values: record.values.map(String) }));
		return {
			...plan,
			available: true,
			existing: existing.length > 0 ? existing : null,
			internal: { read, provider, credentialRow, withIpv6 },
		};
	};

	const publicPlan = ({ internal: _internal, ...plan }) => plan;

	const overrides = (host) => (host?.locations ?? []).some(overridesAcmeChallenge);

	const remembered = (name, address) => {
		const entry = reachCache.get(`${name}|${address}`);
		return entry && clock.now() - entry.at < REACH_FRESH_MS ? entry.outcome : null;
	};

	const remember = (name, address, outcome) => {
		if (reachCache.size >= MAX_REACH_ENTRIES) reachCache.delete(reachCache.keys().next().value);
		reachCache.set(`${name}|${address}`, { at: clock.now(), outcome });
	};

	const runProbe = async ({ name, host, address }) => {
		const outcome = await probe({ name, address, overridesChallenge: overrides(host) });
		const done = { result: outcome.result, port: outcome.port ?? null, detail: outcome.detail ?? null };
		if (address !== null) remember(name, address, done);
		return done;
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
	 * Deletes, at the provider, the addresses a created row wrote; the row's lock is held by the caller. Each address
	 * deleted is cleared on the row at once, so a later try deletes only what is left.
	 *
	 * @throws  {Error}  the scrubbed failure of the first address that could not be deleted
	 */
	const deleteWritten = async (row) => {
		const units = Object.entries(typeOfFamily).filter(([, key]) => typeof row[key] === "string" && row[key] !== "");
		if (units.length === 0) return;
		const credentialRow = await dnsCredentialModel.query().findById(row.dns_credential_id);
		const provider = credentialRow ? providerFor(credentialRow.provider) : null;
		if (!isSupported(provider)) throw new Error("The DNS credential of this record cannot delete it");
		const { fields, secrets } = openCredentialRow(credentialRow);
		const fetch = makeFetch(secrets);
		for (const [type, key] of units) {
			try {
				// gone, or changed (another value is another client's and is kept): either way NPMpro's record is not there
				await provider.remove({
					zone: row.zone,
					name: row.name,
					type,
					value: row[key],
					fields,
					fetch,
					meta: { ...row.meta },
				});
			} catch (error) {
				throw new Error(scrubSecrets(error?.message ?? "The delete failed", secrets));
			}
			await managedRows.patch(row.id, { [key]: null });
		}
	};

	/**
	 * Releases a row (an unticked or removed name, a deleted host): a created row's record is deleted at the provider
	 * first, an adopted one (and a name that held another record) is left there. A failed provider delete keeps the
	 * row as an orphan, never stopping the host's change. Runs under the row's lock, the provider work as the system
	 * (the credential, whoever owns it), audited with the user.
	 */
	const release = (access, id) =>
		recordLock(id, async () => {
			const row = await managedRows.get(id);
			if (!row) return;
			const atProvider = row.origin === "created" && !row.meta?.exists;
			if (atProvider) {
				try {
					await deleteWritten(row);
				} catch (error) {
					const {
						paused_by_host: _paused,
						error_i18n: _key,
						error_values: _values,
						...meta
					} = row.meta ?? {};
					await managedRows.patch(id, {
						enabled: false,
						state: "failed",
						error: error.message,
						failures: 0,
						next_try_on: null,
						meta: { ...meta, orphan: true },
					});
					await audit(access, "orphaned", row, { error: error.message });
					return;
				}
			}
			await managedRows.remove(id);
			await audit(access, "removed", row, { at_provider: atProvider });
		});

	/** An orphan of this host whose name is ticked again: its record is NPMpro's, so the row is simply resumed */
	const resume = (access, row) =>
		recordLock(row.id, async () => {
			const current = await managedRows.get(row.id);
			if (current?.meta?.orphan !== true) return;
			const { orphan: _orphan, ...meta } = current.meta;
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

	/** A tick of a name that has no row of this host: the checks, the reach, the read, then the row */
	const tick = async (access, { hostType, host, entry, zones, addresses }) => {
		const { name } = entry;
		if (access.level("certificates") !== "manage") return refused(name, "unavailable", REASONS.noRight);
		if (host.enabled === false) return refused(name, "unavailable", REASONS.hostDisabled);
		const plan = await inspect(access, { hostType, hostId: host.id, name, ipv6: entry.ipv6, zones, addresses });
		if (plan.covered_by !== null) {
			return answer(name, "covered", { reason: plan.reason, message: plan.message, covered_by: plan.covered_by });
		}
		if (!plan.available) {
			const state = plan.reason === REASONS.readFailed[0] ? "failed" : "unavailable";
			return answer(name, state, { reason: plan.reason, message: plan.message });
		}

		// reach (D28, soft): a proof lets the tick stand, anything else needs the user's "I checked from outside"
		const reach = remembered(name, plan.address) ?? (await runProbe({ name, host, address: plan.address }));
		const confirmed = entry.reach_confirmed === true;
		if (reach.result !== "reachable" && !confirmed) {
			return refused(name, "unavailable", REASONS.reach, { reach });
		}
		const { read, provider, credentialRow, withIpv6 } = plan.internal;
		const ipv6 = withIpv6 ? plan.ipv6_address : null;
		const verdict = decide(read, { ipv4: plan.address, ipv6 });
		const meta = {
			reach: {
				...reach,
				confirmed,
				checked_on: new Date(clock.now()).toISOString(),
				user_id: userIdOf(access),
			},
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
			// Cloudflare's Proxied box is used once, by the create (R13); a later write never changes the flag
			if (entry.proxied === true && provider.proxied === true) meta.proxied_on_create = true;
		} else if (verdict.kind === "adopt") {
			Object.assign(values, {
				origin: "adopted",
				enabled: true,
				state: "ok",
				last_ipv4: plan.address,
				last_ipv6: ipv6 !== null && judge(read.aaaa, ipv6) === "equal" ? ipv6 : null,
				last_checked_on: new Date(clock.now()),
			});
			if (typeof read.a?.proxied === "boolean") meta.proxied_a = read.a.proxied;
		} else {
			Object.assign(values, { origin: null, enabled: false, state: "disabled" });
			meta.exists = { found: verdict.found, adopt_allowed: verdict.adopt_allowed };
		}
		values.meta = meta;

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
			await writeNow(row.id);
		} else if (verdict.kind === "adopt") {
			await audit(access, "adopted", row);
		}
		return null;
	};

	/** The name states of a host: its names in order, then rows of names it no longer has (orphans) */
	const statesOf = async (access, hostType, host, transient = new Map()) => {
		const rows = await managedRows.ofHost(hostType, host.id);
		const names = namesOf(host);
		const list = names.map((name) => {
			if (transient.has(name)) return transient.get(name);
			const row = rows.find((one) => one.name === name);
			return row ? answerOfRow(row, access) : answer(name, "off");
		});
		for (const row of rows) if (!names.includes(row.name)) list.push(answerOfRow(row, access));
		return list;
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

	return {
		/**
		 * The hard checks and the coverage of a host's names, for the DNS card (reads only)
		 *
		 * @param   {Access}  access
		 * @param   {{ hostType: String, host: Object, names?: String[] }}  options  host: the saved row or the form's
		 *          values (domain_names, id when saved); names: those of the host to plan, all by default
		 * @returns {Promise<Object[]>}  [{ name, available, reason, message, covered_by, credential, zone,
		 *          provider_label, address, ipv6_address, ttl, proxied_allowed, existing }]
		 */
		planNames: async (access, { hostType, host, names }) => {
			hostSection(hostType);
			let zonesPromise = null;
			const zones = () => {
				zonesPromise ??= visibleZones(access);
				return zonesPromise;
			};
			const addresses = addressesOnce();
			const list = Array.isArray(names) ? names.map((name) => String(name).toLowerCase()) : namesOf(host);
			const plans = [];
			for (const name of [...new Set(list)]) {
				plans.push(
					publicPlan(
						await inspect(access, { hostType, hostId: host?.id, name, ipv6: true, zones, addresses }),
					),
				);
			}
			return plans;
		},

		/**
		 * The reach probe of one name (POST /nginx/dns-check/reach): to the confirmed public IPv4 only; the result is
		 * kept for the save that follows
		 *
		 * @returns {Promise<{ result, port, detail, address }>}
		 */
		reach: async (access, { hostType, host, name }) => {
			access.can(`${hostSection(hostType)}:manage`);
			const plain = String(name ?? "").toLowerCase();
			if (plain.length > 253 || !PLAIN_NAME.test(plain)) {
				throw new errs.ValidationError(REASONS.pattern[1], REASONS.pattern[0]);
			}
			const address = await addressesOnce().ipv4();
			return { ...(await runProbe({ name: plain, host, address })), address };
		},

		/**
		 * After a host's create or update: the ticks of `wanted` and the names it dropped or the host lost. A host
		 * with no rows and no ticks is not looked at further.
		 *
		 * @param   {Access}  access  the user (rights of a tick; the audit)
		 * @param   {Object}  options
		 * @param   {String}  options.hostType   proxy_host, redirection_host or dead_host
		 * @param   {Object}  [options.hostBefore]  the host before the save (null for a create); not read: the host's rows tell what it had
		 * @param   {Object}  options.hostAfter  the saved host (id, domain_names, enabled, locations)
		 * @param   {Array|undefined}  options.wanted  the request's npmpro_dns_records ([{ name, proxied, ipv6,
		 *          reach_confirmed }]); undefined: the option is not changed (only names the host lost are released)
		 * @returns {Promise<Object[]>}  the name states ([] for a host without the option)
		 */
		applyHost: async (access, { hostType, hostAfter, wanted }) => {
			hostSection(hostType);
			const rows = await managedRows.ofHost(hostType, hostAfter.id);
			const ticks = Array.isArray(wanted) ? dedupe(wanted) : null;
			if (rows.length === 0 && (ticks === null || ticks.size === 0)) return [];
			const names = namesOf(hostAfter);
			const transient = new Map();
			// first the releases: an unticked name, or one the host no longer has
			for (const row of rows) {
				if (row.meta?.orphan === true) continue;
				if (names.includes(row.name) && (ticks === null || ticks.has(row.name))) continue;
				await release(access, row.id);
			}
			if (ticks !== null) {
				let zonesPromise = null;
				const zones = () => {
					zonesPromise ??= visibleZones(access);
					return zonesPromise;
				};
				const addresses = addressesOnce();
				for (const entry of ticks.values()) {
					if (!names.includes(entry.name)) continue;
					const row = rows.find((one) => one.name === entry.name);
					if (row && row.meta?.orphan !== true) continue;
					if (row) {
						// an orphan of this host ticked again: needs the right of a tick, as a new one
						if (access.level("certificates") !== "manage") {
							transient.set(entry.name, refused(entry.name, "unavailable", REASONS.noRight));
							continue;
						}
						await resume(access, row);
						await writeNow(row.id);
						continue;
					}
					const result = await tick(access, { hostType, host: hostAfter, entry, zones, addresses });
					if (result !== null) transient.set(entry.name, result);
				}
			}
			return await statesOf(access, hostType, hostAfter, transient);
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

		/** An enabled host resumes its paused rows: pending, written by the next cycle */
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

		/** A deleted host: as unticking every name (created records deleted at the provider, adopted ones released) */
		onDelete: async (access, { hostType, host }) => {
			hostSection(hostType);
			for (const row of await managedRows.ofHost(hostType, host.id)) {
				if (row.meta?.orphan !== true) await release(access, row.id);
			}
			return (await managedRows.ofHost(hostType, host.id)).map((row) => answerOfRow(row, access));
		},

		/** The name states of a saved host (expand=dns_records); [] for a host without the option */
		statesOf: async (access, { hostType, host }) => {
			hostSection(hostType);
			const rows = await managedRows.ofHost(hostType, host.id);
			return rows.length === 0 ? [] : await statesOf(access, hostType, host);
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
				const { exists: _exists, ...meta } = current.meta;
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
				if (row?.meta?.orphan !== true) return;
				try {
					await deleteWritten(row);
				} catch (error) {
					await managedRows.patch(id, { error: error.message });
					return;
				}
				await managedRows.remove(id);
				await audit(access, "removed", row, { at_provider: true });
			});
			const left = await managedRows.get(id);
			return left ? answerOfRow(left, access) : answer(visible.name, "off");
		},
	};
};

const hostDnsRecords = createHostDnsRecords();

export { createHostDnsRecords };
export default hostDnsRecords;
