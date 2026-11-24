// What the Dynamic DNS tab shows: the state of the public IP card, when the next check is due and the address cell of
// a record. Pure.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The state of the status card: "none" (no enabled record, nothing is checked), "paused" (a restore or a database
 * move), "failed" (an address a record needs could not be found), "waiting" (no address a record needs found yet),
 * else "ok" (also when the enabled records are aliases only, which need no address). An error of a family no record
 * needs (left from a deleted record) does not count.
 *
 * @param   {Object | undefined}  status  GET /nginx/ddns/status (camelCase)
 * @param   {{ ipv4: boolean, ipv6: boolean }}  [needed]  familiesNeeded of the records; both when not known yet
 * @returns {"none" | "paused" | "failed" | "waiting" | "ok"}
 */
const ddnsStatusOf = (status, needed = { ipv4: true, ipv6: true }) => {
	if (!status?.records) return "none";
	if (status.paused) return "paused";
	const families = neededFamilies(status, needed);
	if (families.length === 0) return "ok";
	if (families.some(hasError)) return "failed";
	if (!families.some((family) => family?.address)) return "waiting";
	return "ok";
};

const hasError = (family) => Boolean(family?.error || family?.errorI18n);
const neededFamilies = (status, needed) =>
	[needed.ipv4 ? [status?.ipv4] : [], needed.ipv6 ? [status?.ipv6] : []].flat();

/**
 * The first error of the status a record needs, from the IPv4 line or else the IPv6 line
 *
 * @param   {Object | undefined}  status
 * @param   {{ ipv4: boolean, ipv6: boolean }}  [needed]  both when not known yet
 * @returns {Object | null}  the family state that holds an error (for ddnsErrorOf), or null
 */
const statusErrorItem = (status, needed = { ipv4: true, ipv6: true }) =>
	neededFamilies(status, needed).find(hasError) ?? null;

/**
 * The time until the next check as a number and a unit for Intl.RelativeTimeFormat (rounded up, at least a minute
 * at the smallest unit), or null when no check is scheduled.
 *
 * @param   {string | null | undefined}  nextRunOn  ISO time
 * @param   {number}  now  milliseconds
 * @returns {{ value: number, unit: "minute" | "hour" | "day" } | null}
 */
const nextCheckIn = (nextRunOn, now) => {
	const time = typeof nextRunOn === "string" ? Date.parse(nextRunOn) : Number.NaN;
	if (Number.isNaN(time)) return null;
	const left = Math.max(0, time - now);
	if (left < HOUR_MS) return { value: Math.max(1, Math.ceil(left / MINUTE_MS)), unit: "minute" };
	if (left < DAY_MS) return { value: Math.ceil(left / HOUR_MS), unit: "hour" };
	return { value: Math.ceil(left / DAY_MS), unit: "day" };
};

/**
 * The addresses a record holds, for the Address column: the alias target, else the IPv4 and IPv6 it wrote for the
 * IP version it follows (empty before its first write).
 *
 * @param   {Object}  record  camelCase record of the API
 * @returns {{ alias: string } | { addresses: string[] }}
 */
const recordAddressOf = (record) => {
	if (record.kind === "alias") return { alias: record.target ?? "" };
	const wanted = record.ipVersion === "both" ? [record.lastIpv4, record.lastIpv6] : null;
	const own = record.ipVersion === "ipv6" ? [record.lastIpv6] : [record.lastIpv4];
	return { addresses: (wanted ?? own).filter(Boolean) };
};

/**
 * The families the records need: one is needed when an enabled address record follows it (aliases need none).
 *
 * @param   {Array<{ enabled?: boolean, kind?: string, ipVersion?: string }> | undefined}  records  camelCase records
 * @returns {{ ipv4: boolean, ipv6: boolean }}
 */
const familiesNeeded = (records) => {
	const live = (records ?? []).filter((record) => record.enabled && record.kind !== "alias");
	return {
		ipv4: live.some((record) => record.ipVersion === "ipv4" || record.ipVersion === "both"),
		ipv6: live.some((record) => record.ipVersion === "ipv6" || record.ipVersion === "both"),
	};
};

/**
 * What one address line of the status card shows: "address" (known), "unchecked" (no enabled address record needs
 * the family, an old error of it aside), "failed" (needed, checked and failed), else "unknown" (needed, no address
 * found yet).
 *
 * @param   {Object | undefined}  family  status.ipv4 or status.ipv6
 * @param   {boolean}  needed  whether an enabled address record follows this family
 * @returns {"address" | "failed" | "unchecked" | "unknown"}
 */
const familyLineOf = (family, needed) => {
	if (family?.address) return "address";
	if (!needed) return "unchecked";
	return hasError(family) ? "failed" : "unknown";
};

/**
 * How long ago a time was, as a negative number and a unit for Intl.RelativeTimeFormat (rounded down; under a
 * minute counts as 0 minutes), or null for no valid time.
 *
 * @param   {string | null | undefined}  iso
 * @param   {number}  now  milliseconds
 * @returns {{ value: number, unit: "minute" | "hour" | "day" } | null}
 */
const ageOf = (iso, now) => {
	const time = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
	if (Number.isNaN(time)) return null;
	const past = Math.max(0, now - time);
	if (past < HOUR_MS) return { value: -Math.floor(past / MINUTE_MS) || 0, unit: "minute" };
	if (past < DAY_MS) return { value: -Math.floor(past / HOUR_MS) || 0, unit: "hour" };
	return { value: -Math.floor(past / DAY_MS) || 0, unit: "day" };
};

export { ageOf, ddnsStatusOf, familiesNeeded, familyLineOf, nextCheckIn, recordAddressOf, statusErrorItem };
