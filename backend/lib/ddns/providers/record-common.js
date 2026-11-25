import { isIP } from "node:net";
import { DdnsProviderError } from "../errors.js";

const TRAILING_DOT = /\.$/u;
const WILDCARD = "This provider does not support wildcard records";

/**
 * The record name without the zone: `@` for the apex, `www` for www.<zone>, `*` for *.<zone>.
 *
 * @param   {String} zone
 * @param   {String} name  the full record name
 * @returns {String}
 */
const relativeName = (zone, name) => {
	const full = name.toLowerCase();
	const z = zone.toLowerCase();
	if (full === z) return "@";
	return full.endsWith(`.${z}`) ? full.slice(0, -(z.length + 1)) : full;
};

/** The relative name as a path segment: `@` stays as it is (Hetzner and Gandi spell the apex so) */
const pathName = (zone, name) => encodeURIComponent(relativeName(zone, name)).replace("%40", "@");

const isWildcardName = (name) => name.startsWith("*.") || name === "*";

/** Hetzner Cloud and Gandi: a wildcard name is refused with a clear error */
const refuseWildcard = (name) => {
	if (isWildcardName(name)) throw new DdnsProviderError({ code: "failed", message: WILDCARD, retry: false });
};

/** A CNAME target as the engine compares it: lower case, no trailing dot */
const plainTarget = (value) =>
	String(value ?? "")
		.toLowerCase()
		.replace(TRAILING_DOT, "");

/** A CNAME target as a provider that wants an absolute name takes it */
const dotted = (value) => `${plainTarget(value)}.`;

/** The zone is not on this credential (or does not exist): retrying without a fix cannot help */
const zoneNotFound = (res, secrets) =>
	new DdnsProviderError({
		providerStatus: res.status,
		code: "failed",
		message: "The zone was not found for this credential: check the credential and the domain",
		retry: false,
		secrets,
	});

/** A record set with more than one value is never written (A11) */
const refuseMultiple = (existing) => {
	if (Array.isArray(existing?.values) && existing.values.length > 1) {
		throw new DdnsProviderError({
			code: "failed",
			message: "The record has more than one value and is not changed",
			retry: false,
		});
	}
};

const jsonHeaders = (headers) => ({ ...headers, "Content-Type": "application/json" });

/**
 * The record a write meant to change is gone at the provider (deleted between the read and the write): retried, and
 * the next check creates it again
 *
 * @param   {{ status: number }}  res
 * @param   {string[]}            secrets
 * @returns {DdnsProviderError}
 */
const recordGone = (res, secrets) =>
	new DdnsProviderError({
		providerStatus: res.status,
		code: "failed",
		message: "The record was removed at the provider; it is created again on the next check",
		secrets,
	});

/** The same address however it is spelled (an IPv6 address is compared in its canonical form) */
const sameAddress = (a, b) => {
	const left = String(a ?? "").trim();
	const right = String(b ?? "").trim();
	const family = isIP(left);
	if (family === 0 || family !== isIP(right)) return false;
	if (family === 4) return left === right;
	try {
		return new URL(`http://[${left}]`).hostname === new URL(`http://[${right}]`).hostname;
	} catch {
		return false;
	}
};

/**
 * What a record delete may touch: an A or AAAA record at a name inside the zone, with the address NPMpro wrote.
 * Anything else is refused before a call. Returns the lower case name.
 *
 * @param   {Object} options
 * @param   {String} options.zone
 * @param   {String} options.name
 * @param   {String} options.type   A or AAAA
 * @param   {String} options.value  the address that was written
 * @returns {String}
 */
const assertRemovable = ({ zone, name, type, value }) => {
	const full = typeof name === "string" ? name.toLowerCase() : "";
	const z = String(zone ?? "").toLowerCase();
	const families = { A: 4, AAAA: 6 };
	const family = Object.hasOwn(families, type) ? families[type] : 0;
	if (
		family === 0 ||
		isIP(String(value ?? "").trim()) !== family ||
		z === "" ||
		!(full === z || full.endsWith(`.${z}`))
	) {
		throw new DdnsProviderError({
			code: "failed",
			message: "Not an A or AAAA record of this zone with an address",
			retry: false,
		});
	}
	return full;
};

/**
 * Looks at the values found at the name: none is gone, one that is exactly the written address is the record to
 * delete, anything else (another address, more than one value) is another client's and is kept.
 *
 * @param   {String[]} found  the values at the name and type
 * @param   {String}   value  the address that was written
 * @returns {"gone"|"changed"|"one"}
 */
const judgeSet = (found, value) => {
	if (found.length === 0) return "gone";
	return found.length === 1 && sameAddress(found[0], value) ? "one" : "changed";
};

export {
	assertRemovable,
	dotted,
	jsonHeaders,
	judgeSet,
	pathName,
	plainTarget,
	recordGone,
	refuseMultiple,
	refuseWildcard,
	relativeName,
	sameAddress,
	zoneNotFound,
};
