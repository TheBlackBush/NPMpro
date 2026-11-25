import { coveringZone } from "./DnsDomainMatch.js";

// The host record option of the DNS card (backend/internal/host-dns-record.js): which boxes a name offers, the line of
// each state, what a save sends and when the states are read again. Pure; the card and the lists only draw it.

const MANAGED_STATES = ["ok", "pending", "failed", "paused", "exists"];
const POLL_MS = 3000;
const POLL_LIMIT = 10;
const MIN_TTL = 300;
// a plain host name: letters and digits (any script) with dots and dashes; a wildcard or a pattern is no plain name
const PLAIN_NAME = /^[\p{L}\p{N}][\p{L}\p{N}.-]*$/u;

// the reason keys of the server, written out whole (the unused-key check reads them here)
const REASON_IDS = {
	"error.host-dns-wildcard": "error.host-dns-wildcard",
	"error.host-dns-pattern": "error.host-dns-pattern",
	"error.host-dns-no-right": "error.host-dns-no-right",
	"error.host-dns-no-credential": "error.host-dns-no-credential",
	"error.host-dns-many-credentials": "error.host-dns-many-credentials",
	"error.host-dns-provider-unsupported": "error.host-dns-provider-unsupported",
	"error.host-dns-no-public-address": "error.host-dns-no-public-address",
	"error.host-dns-host-disabled": "error.host-dns-host-disabled",
	"error.host-dns-name-taken": "error.host-dns-name-taken",
	"error.host-dns-reach-unconfirmed": "error.host-dns-reach-unconfirmed",
	"error.host-dns-read-failed": "error.host-dns-read-failed",
	"error.host-dns-read-skipped": "error.host-dns-read-skipped",
	"host-dns.other-owner": "host-dns.other-owner",
};
const STATE_IDS = {
	ok: "host-dns.state.ok",
	adopted: "host-dns.state.adopted",
	pending: "host-dns.state.pending",
	failed: "host-dns.state.failed",
	paused: "host-dns.state.paused",
	orphan: "host-dns.state.orphan",
	unavailable: "host-dns.state.unavailable",
};
const TONES = {
	ok: "success",
	pending: "warning",
	failed: "destructive",
	paused: "warning",
	orphan: "destructive",
	covered: "success",
	exists: "warning",
	unavailable: "muted",
};
const REACH_IDS = {
	reachable: "host-dns.reach.reachable",
	"could-not-confirm": "host-dns.reach.could-not-confirm",
	"router-answered": "host-dns.reach.router-answered",
	overridden: "host-dns.reach.overridden",
	"no-public-address": "error.host-dns-no-public-address",
};

const lower = (name) => String(name ?? "").toLowerCase();
const isPlainName = (name) => PLAIN_NAME.test(String(name ?? "").trim());

/**
 * The TTL a new record gets: the TTL an existing record keeps, else 300 raised to the provider's lowest TTL
 *
 * @param   {{ minTtl?: number|null }|null|undefined} provider  an entry of GET /nginx/ddns/providers
 * @param   {{ ttl?: number|null }|null} [existing]  the record already at the name
 * @returns {number}
 */
export function ttlFor(provider, existing) {
	if (Number.isInteger(existing?.ttl) && existing.ttl > 0) return existing.ttl;
	const floor = Number.isInteger(provider?.minTtl) ? provider.minTtl : 0;
	return Math.max(MIN_TTL, floor);
}

/**
 * Whether the user must say "I checked from outside": every probe answer but reachable, and a probe that did not run
 * (the check is soft, never a refusal from inside). No public address is a block, not a confirmation (reachBlocked).
 *
 * @param   {{ result?: string }|null|undefined} probe  the answer of POST /nginx/dns-check/reach
 * @returns {boolean}
 */
export function needsReachConfirm(probe) {
	return !(probe?.result === "reachable" || probe?.result === "no-public-address");
}

/** Whether the probe found no public address: the name cannot be ticked */
export const reachBlocked = (probe) => probe?.result === "no-public-address";

/** The text of a probe answer: { id, values } */
export function reachText(probe) {
	const id = REACH_IDS[probe?.result] ?? "host-dns.reach.failed";
	return { id, values: { address: probe?.address ?? "", port: probe?.port ?? 80 } };
}

/**
 * The credential, zone and provider that would keep a name, and why it cannot (the checks the server makes again on
 * Save): a wildcard or a pattern name, no right, no credential, two credentials, a provider without records
 *
 * @param   {Object} input
 * @param   {string} input.name
 * @param   {Array<Object>} input.domains  GET /nginx/dns-domains with expand=credential (camelCase)
 * @param   {Array<Object>} input.providers  GET /nginx/ddns/providers (camelCase)
 * @param   {number} [input.userId]
 * @param   {boolean} input.canManage  Certificates manage
 * @param   {string|null} [input.address]  the public IPv4
 * @param   {string|null} [input.ipv6Address]  the public IPv6, when one was detected
 * @returns {{ name: string, blocked: string|null, credential: Object|null, provider: Object|null, zone: string|null,
 *            ttl: number, address: string|null, ipv6Address: string|null }}  blocked: the reason key
 */
export function planOf({ name, domains, providers, userId, canManage, address = null, ipv6Address = null }) {
	const plan = {
		name,
		blocked: null,
		credential: null,
		provider: null,
		zone: null,
		ttl: ttlFor(null),
		address,
		ipv6Address,
	};
	if (String(name).includes("*")) return { ...plan, blocked: "error.host-dns-wildcard" };
	if (!isPlainName(name)) return { ...plan, blocked: "error.host-dns-pattern" };
	if (!canManage) return { ...plan, blocked: "error.host-dns-no-right" };
	const zones = (domains ?? [])
		.filter((domain) => domain.credential)
		.map((domain) => ({
			name: domain.name,
			credentialId: domain.dnsCredentialId,
			ownerUserId: domain.credential.ownerUserId,
		}));
	const cover = coveringZone(name, zones, userId);
	if (cover === null) return { ...plan, blocked: "error.host-dns-no-credential" };
	if (cover.credentialIds.length > 1) return { ...plan, blocked: "error.host-dns-many-credentials" };
	const credential = (domains ?? []).find((domain) => domain.dnsCredentialId === cover.credentialIds[0])?.credential;
	const provider =
		(providers ?? []).find((entry) => entry.credentialProvider === credential?.provider && !entry.preset) ?? null;
	const found = { ...plan, credential: credential ?? null, provider, zone: cover.zone, ttl: ttlFor(provider) };
	if (provider === null || provider.zoneless === true)
		return { ...found, blocked: "error.host-dns-provider-unsupported" };
	return found;
}

const foundText = (found) => {
	const first = found?.[0];
	return first ? { type: first.type, value: (first.values ?? []).join(", ") } : null;
};

// the state line of a name that has a state from the server
function lineOf(record) {
	const state = record.state;
	if (state === "ok") {
		const id = record.origin === "adopted" ? STATE_IDS.adopted : STATE_IDS.ok;
		return { id, values: {}, tone: TONES.ok, detail: null };
	}
	if (state === "pending" || state === "paused")
		return { id: STATE_IDS[state], values: {}, tone: TONES[state], detail: null };
	if (state === "failed" || state === "orphan") {
		return { id: STATE_IDS[state], values: {}, tone: TONES[state], detail: record.message ?? null };
	}
	if (state === "covered") {
		const by = record.coveredBy;
		const id = by ? "host-dns.covered-by-wildcard" : "host-dns.covered-by-other";
		if (record.reason === "host-dns.covered-by-record") {
			return { id: "host-dns.covered-by-record", values: {}, tone: TONES.covered, detail: null };
		}
		return { id, values: { name: by ?? "" }, tone: TONES.covered, detail: null };
	}
	if (state === "exists") {
		const found = foundText(record.found);
		const id = record.adoptAllowed === true ? "host-dns.exists" : "host-dns.exists-remove-first";
		return { id, values: found ?? { type: "A", value: "" }, tone: TONES.exists, detail: null };
	}
	if (state === "unavailable") {
		const id = REASON_IDS[record.reason] ?? STATE_IDS.unavailable;
		return {
			id,
			values: {},
			tone: TONES.unavailable,
			detail: REASON_IDS[record.reason] ? null : (record.message ?? null),
		};
	}
	return null;
}

/**
 * What one name of the DNS card offers
 *
 * @param   {Object} plan  planOf(...)
 * @param   {Object|null|undefined} record  the name's state from the server (camelCase), none for a name without one
 * @param   {{ canTick: boolean, readOnly: boolean }} rights  canTick: Certificates manage; readOnly: a View window
 * @returns {{ line: Object|null, tickable: boolean, managed: boolean, blocked: string|null, actions: string[], showProxied: boolean,
 *            showIpv6: boolean, willCreate: Object|null }}
 *          line: { id, values, tone, detail } of the server's state; actions: adopt, leave, remove;
 *          blocked: the reason key a name cannot be ticked
 */
export function nameRow(plan, record, rights) {
	const has = record && record.state !== "off" ? record : null;
	const line = has ? lineOf(has) : null;
	const actions = [];
	if (has && !rights.readOnly) {
		if (has.state === "exists") {
			if (has.adoptAllowed === true && rights.canTick) actions.push("adopt");
			actions.push("leave");
		}
		if (has.state === "orphan" && rights.canTick) actions.push("remove");
	}
	const managed = has !== null && MANAGED_STATES.includes(has.state);
	const tickable = managed || (plan.blocked === null && !rights.readOnly);
	const free = !managed;
	const address = plan.address;
	let willCreate = null;
	if (free && plan.blocked === null && plan.provider) {
		const values = {
			ttl: plan.ttl,
			provider: plan.provider.label,
			zone: plan.zone,
			address,
			ipv6: plan.ipv6Address ?? "",
		};
		willCreate = { id: address ? "host-dns.will-create" : "host-dns.will-create-unknown", values };
	}
	return {
		line,
		tickable,
		managed,
		blocked: free ? plan.blocked : null,
		actions,
		showProxied: free && plan.blocked === null && plan.provider?.proxied === true,
		showIpv6: free && plan.blocked === null && plan.provider?.ipv6 === true && Boolean(plan.ipv6Address),
		willCreate,
	};
}

/**
 * The entries a form starts with: the names that hold a row of the option (a name left out is released on Save)
 *
 * @param   {Array<Object>|undefined} records  the states of the host (camelCase)
 * @param   {string[]} names  the host's names now
 * @returns {Array<{ name: string, ipv6: boolean }>}
 */
export function ticksOf(records, names) {
	const present = new Set((names ?? []).map(lower));
	return (records ?? [])
		.filter((record) => MANAGED_STATES.includes(record.state) && present.has(lower(record.name)))
		.map((record) => ({ name: record.name, ipv6: record.ipv6 === true }));
}

/**
 * The request field of a save: one entry per ticked name that the host still has; undefined (field left out, the
 * option stays as it is) until the card was touched, an empty list when everything was unticked
 *
 * @param   {{ npmproDnsRecords?: Array<Object>, domainNames?: string[] }} values
 * @returns {Array<{ name: string, proxied?: boolean, ipv6?: boolean, reachConfirmed?: boolean }>|undefined}
 */
export function wantedFromForm(values) {
	const entries = values?.npmproDnsRecords;
	if (!Array.isArray(entries)) return;
	const present = new Set((values.domainNames ?? []).map(lower));
	const seen = new Set();
	const wanted = [];
	for (const entry of entries) {
		const key = lower(entry.name);
		if (present.has(key) && !seen.has(key)) {
			seen.add(key);
			wanted.push({
				name: entry.name,
				...(entry.proxied === true ? { proxied: true } : {}),
				...(entry.ipv6 === true ? { ipv6: true } : {}),
				...(entry.reachConfirmed === true ? { reachConfirmed: true } : {}),
			});
		}
	}
	return wanted;
}

/**
 * The state a list badge shows for a host with managed rows: red for failed or orphan, amber for pending, exists or
 * paused, green for ok; covered, unavailable and off names count for nothing
 *
 * @param   {Array<{ state: string }>|undefined} records
 * @returns {{ state: string, tone: string }|null}  null for a host without managed rows
 */
export function recordsBadge(records) {
	const states = (records ?? []).map((record) => record.state);
	for (const [group, tone] of [
		[["failed", "orphan"], "destructive"],
		[["pending", "exists", "paused"], "warning"],
		[["ok"], "success"],
	]) {
		const found = group.find((state) => states.includes(state));
		if (found) return { state: found, tone };
	}
	return null;
}

/**
 * How long until the states are read again: while a name is pending, every 3 seconds, at most 10 times
 *
 * @param   {Array<{ state: string }>|undefined} records
 * @param   {number} attempts  the reads made since a name became pending
 * @returns {number|false}
 */
export function pollDelay(records, attempts) {
	const pending = (records ?? []).some((record) => record.state === "pending");
	return pending && attempts < POLL_LIMIT ? POLL_MS : false;
}

/** The line of a name's state for a list tooltip: { id, values, tone, detail }, null for a name without one */
export const stateLine = (record) => lineOf(record);
