// The host record option of the DNS card (backend/internal/host-dns-record.js): which boxes a name offers, the line of
// each state, what a save sends and when the states are read again. The plan of a name (credential, zone, TTL, the
// public addresses, why it cannot get a record) is the answer of POST /nginx/dns-check/plan: this module only reads it.
// Pure; the card and the lists only draw it.

const MANAGED_STATES = ["ok", "pending", "failed", "paused", "exists"];
const POLL_MS = 3000;
const POLL_LIMIT = 10;
const POLL_WINDOW_MS = 2 * 60 * 1000;
// the server keeps a probe answer 10 minutes; the window asks again for the user's confirmation a minute sooner
const REACH_FRESH_MS = 9 * 60 * 1000;

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
const sameName = (a, b) => lower(a) === lower(b);

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
	return Math.max(300, floor);
}

/**
 * Whether the user must say "I checked from outside": every probe answer but a reachable one that the server still
 * remembers, and a probe that did not run (the check is soft, never a refusal from inside). No public address is a
 * block, not a confirmation (reachBlocked).
 *
 * @param   {{ result?: string, at?: number }|null|undefined} probe  the answer of POST /nginx/dns-check/reach, `at`
 *          the time it came (ms)
 * @param   {number} [now]  ms; without it an answer never goes stale
 * @returns {boolean}
 */
export function needsReachConfirm(probe, now) {
	if (probe?.result === "no-public-address") return false;
	if (probe?.result !== "reachable") return true;
	return now !== undefined && now - (probe.at ?? 0) >= REACH_FRESH_MS;
}

/** Whether the probe found no public address: the name cannot be ticked */
export const reachBlocked = (probe) => probe?.result === "no-public-address";

/** The text of a probe answer: { id, values } */
export function reachText(probe) {
	const id = REACH_IDS[probe?.result] ?? "host-dns.reach.failed";
	return { id, values: { address: probe?.address ?? "", port: probe?.port ?? 80 } };
}

const foundText = (found) => {
	const first = found?.[0];
	return first ? { type: first.type, value: (first.values ?? []).join(", ") } : null;
};

// the line of a reason key of the server (a plan's or a state's)
function reasonLine(reason, message, coveredBy) {
	if (reason === "host-dns.covered-by-record") {
		return { id: "host-dns.covered-by-record", values: {}, tone: TONES.covered, detail: null };
	}
	if (reason === "host-dns.covered-by-wildcard" || reason === "host-dns.covered-by-other") {
		const id = coveredBy ? "host-dns.covered-by-wildcard" : "host-dns.covered-by-other";
		return { id, values: { name: coveredBy ?? "" }, tone: TONES.covered, detail: null };
	}
	const id = REASON_IDS[reason];
	return {
		id: id ?? STATE_IDS.unavailable,
		values: {},
		tone: TONES.unavailable,
		detail: id ? null : (message ?? null),
	};
}

// the state line of a name that has a state from the server
function lineOf(record) {
	const state = record.state;
	// another owner's row keeps its real state, but is shown as "Managed by another user", without values
	if (record.reason === "host-dns.other-owner") {
		return { id: "host-dns.other-owner", values: {}, tone: TONES.unavailable, detail: null };
	}
	if (state === "ok") {
		const id = record.origin === "adopted" ? STATE_IDS.adopted : STATE_IDS.ok;
		return { id, values: {}, tone: TONES.ok, detail: null };
	}
	if (state === "pending" || state === "paused") {
		return { id: STATE_IDS[state], values: {}, tone: TONES[state], detail: null };
	}
	if (state === "failed" || state === "orphan") {
		return { id: STATE_IDS[state], values: {}, tone: TONES[state], detail: record.message ?? null };
	}
	if (state === "covered") return reasonLine(record.reason, record.message, record.coveredBy);
	if (state === "exists") {
		const found = foundText(record.found);
		const id = record.adoptAllowed === true ? "host-dns.exists" : "host-dns.exists-remove-first";
		return { id, values: found ?? { type: "A", value: "" }, tone: TONES.exists, detail: null };
	}
	if (state === "unavailable") return reasonLine(record.reason, record.message, null);
	return null;
}

/**
 * What one name of the DNS card offers
 *
 * @param   {Object|undefined} plan  the name's entry of POST /nginx/dns-check/plan (camelCase); undefined while it loads
 * @param   {Object|null|undefined} record  the name's state from the server (camelCase), none for a name without one
 * @param   {{ canTick: boolean, readOnly: boolean, ipv6?: boolean, ipv6Address?: string|null,
 *            hostDisabled?: boolean }} rights  canTick: Certificates manage; readOnly: a View window; ipv6: the AAAA box
 *          is ticked; ipv6Address: the server's public IPv6 (the answer's own)
 * @returns {{ line: Object|null, tickable: boolean, managed: boolean, blocked: Object|null, actions: string[],
 *            showProxied: boolean, showIpv6: boolean, existing: Object|null, willCreate: Object|null }}
 *          line: { id, values, tone, detail } of the server's state; actions: adopt, leave, remove;
 *          blocked: the line of why a free name cannot be ticked; existing: the line of a record already at the name
 */
export function nameRow(plan, record, rights) {
	const has = record && record.state !== "off" ? record : null;
	const line = has ? lineOf(has) : null;
	const actions = [];
	if (has && !rights.readOnly && has.reason !== "host-dns.other-owner") {
		if (has.state === "exists") {
			if (has.adoptAllowed === true && rights.canTick) actions.push("adopt");
			actions.push("leave");
		}
		if (has.state === "orphan" && rights.canTick) actions.push("remove");
	}
	const managed = has !== null && MANAGED_STATES.includes(has.state);
	let blocked = null;
	if (!managed && plan) {
		if (rights.hostDisabled === true) blocked = reasonLine("error.host-dns-host-disabled");
		else if (plan.available !== true) blocked = reasonLine(plan.reason, plan.message, plan.coveredBy);
	}
	const free = !managed && Boolean(plan) && blocked === null;
	const found = free ? foundText(plan.existing) : null;
	const ipv6Address = rights.ipv6Address ?? plan?.ipv6Address ?? null;
	let willCreate = null;
	if (free && plan.existing === null) {
		const withIpv6 = rights.ipv6 === true && ipv6Address !== null;
		willCreate = {
			id: withIpv6 ? "host-dns.will-create-ipv6" : "host-dns.will-create",
			values: {
				address: plan.address,
				ipv6: ipv6Address ?? "",
				ttl: plan.ttl,
				provider: plan.providerLabel,
				zone: plan.zone,
			},
		};
	}
	return {
		line,
		tickable: managed || (free && !rights.readOnly),
		managed,
		blocked,
		actions,
		showProxied: free && plan.proxiedAllowed === true && plan.existing === null,
		showIpv6: free && ipv6Address !== null && plan.existing === null,
		existing: found ? { id: "host-dns.exists", values: found, tone: TONES.exists, detail: null } : null,
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

/** The ticks with a name added (once) */
export const withTick = (ticks, name) =>
	ticks.some((entry) => sameName(entry.name, name))
		? ticks
		: [...ticks, { name, proxied: false, ipv6: false, reachConfirmed: false }];

/** The ticks without a name */
export const withoutTick = (ticks, name) => ticks.filter((entry) => !sameName(entry.name, name));

/** The ticks with one entry replaced (matched by name) */
export const withChange = (ticks, next) => ticks.map((entry) => (sameName(entry.name, next.name) ? next : entry));

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

const BADGE_STATES = ["ok", "pending", "exists", "paused", "failed", "orphan"];

/** The names of a host's badge tooltip: one line per managed name, { name, line } */
export const badgeLines = (records) =>
	(records ?? [])
		.filter((record) => BADGE_STATES.includes(record.state))
		.map((record) => ({ name: record.name, line: lineOf(record) }));

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

/**
 * A poller for refetchInterval: it counts the reads and does not start over when polling stops, so a host that stays
 * pending is read at most 10 times in 2 minutes however often its query is fetched again; a later save, after the
 * window has passed, gets its own reads
 *
 * @param   {() => number} [now]
 * @returns {(records: Array<{ state: string }>|undefined) => number|false}
 */
export function createPoller(now = Date.now) {
	let count = 0;
	let since = 0;
	return (records) => {
		const time = now();
		if (time - since >= POLL_WINDOW_MS) {
			count = 0;
			since = time;
		}
		const delay = pollDelay(records, count);
		if (delay !== false) count += 1;
		return delay;
	};
}

/** The line of a name's state for a list tooltip: { id, values, tone, detail }, null for a name without one */
export const stateLine = (record) => lineOf(record);
