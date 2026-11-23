import { resolverAddressProblem } from "./ResolverAddress.js";

// The Dynamic DNS settings' rules, the twins of the ddns rules in backend/lib/runtime-rule-table.js. A value equal to
// the stored one (data, as the API returns it) is never refused: a save that keeps it passes. Pure.

const DDNS_TIME = /^(?:[0-9]+|(?:[0-9]+w)?(?:[0-9]+d)?(?:[0-9]+h)?(?:[0-9]+m)?(?:[0-9]+s)?)$/u;
const DDNS_TIME_PART = /(?<amount>[0-9]+)(?<unit>[wdhms])/gu;
const DIGITS = /^[0-9]+$/u;
const SECONDS = { w: 604_800, d: 86_400, h: 3600, m: 60, s: 1 };
const MIN_MS = 60_000;
const MAX_MS = 86_400_000;
const MAX_TIME_LENGTH = 32;
const SERVICE_URL = /^https:\/\/(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~/%-]*)?$/u;
// a new address counts only when a second service confirms it, so a list needs two (a stored list of one passes a
// save that keeps it, as the backend's validateSave)
const MIN_SERVICES = 2;
const MAX_SERVICES = 10;
const MAX_URL_LENGTH = 200;

/**
 * A time such as 5m, 90 or 1h30m in milliseconds, null when it is not a time from 1m to 24h
 *
 * @param   {unknown}  value
 * @returns {number | null}
 */
const ddnsTimeMs = (value) => {
	if (typeof value !== "string" || value === "" || value.length > MAX_TIME_LENGTH || !DDNS_TIME.test(value)) {
		return null;
	}
	let seconds = DIGITS.test(value) ? Number(value) : 0;
	if (!DIGITS.test(value)) {
		for (const { groups } of value.matchAll(DDNS_TIME_PART)) {
			seconds += Number(groups.amount) * SECONDS[groups.unit];
		}
	}
	const ms = seconds * 1000;
	return ms >= MIN_MS && ms <= MAX_MS ? ms : null;
};

/**
 * One address service: an https URL without credentials (a host name or IP, an optional port and path)
 *
 * @param   {unknown}  entry
 * @returns {boolean}
 */
const isServiceUrl = (entry) => typeof entry === "string" && entry.length <= MAX_URL_LENGTH && SERVICE_URL.test(entry);

/**
 * The first problem of a service list (a URL that is not one first, then the count of 2 to 10), or null
 *
 * @param   {unknown}  list
 * @returns {{ error: "count" } | { error: "invalid", url: string } | null}
 */
const serviceListProblem = (list) => {
	if (!Array.isArray(list)) return { error: "count" };
	const bad = list.find((entry) => !isServiceUrl(entry));
	if (bad !== undefined) return { error: "invalid", url: bad };
	return list.length < MIN_SERVICES || list.length > MAX_SERVICES ? { error: "count" } : null;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The errors of the Dynamic DNS settings form, by field
 *
 * @param   {Object}  rules   Validations
 * @param   {Object}  values  form values (period, cooldown, ipv4Services, ipv6Services, resolver)
 * @param   {Object}  [data]  the loaded group
 * @returns {Object}
 */
const ddnsSettingsValidate = (rules, values, data) => {
	const errors = {};
	for (const key of ["period", "cooldown"]) {
		const text = String(values[key] ?? "").trim();
		if (text !== data?.[key] && ddnsTimeMs(text) === null) {
			errors[key] = rules.message("settings.dynamic-dns.time.invalid");
		}
	}
	for (const key of ["ipv4Services", "ipv6Services"]) {
		const problem = same(values[key], data?.[key]) ? null : serviceListProblem(values[key]);
		if (problem?.error === "count") errors[key] = rules.message("settings.dynamic-dns.services.count");
		else if (problem) errors[key] = rules.message("settings.dynamic-dns.services.invalid", { url: problem.url });
	}
	if (!same(values.resolver, data?.resolver)) {
		const problem = resolverAddressProblem(values.resolver ?? []);
		if (problem?.error === "too-many") errors.resolver = rules.message("settings.nginx.resolver.too-many");
		else if (problem?.error === "duplicate") {
			errors.resolver = rules.message("settings.nginx.resolver.duplicate", { address: problem.address });
		} else if (problem) {
			errors.resolver = rules.message("settings.nginx.resolver.invalid", { address: problem.address ?? "" });
		}
	}
	return errors;
};

const ddnsToForm = (data) => ({
	period: data.period ?? "",
	cooldown: data.cooldown ?? "",
	ipv4Services: [...(data.ipv4Services ?? [])],
	ipv6Services: [...(data.ipv6Services ?? [])],
	resolver: [...(data.resolver ?? [])],
});

const ddnsToApi = (values) => ({
	...values,
	period: String(values.period ?? "").trim(),
	cooldown: String(values.cooldown ?? "").trim(),
});

export { ddnsSettingsValidate, ddnsTimeMs, ddnsToApi, ddnsToForm, isServiceUrl, MAX_SERVICES, serviceListProblem };
