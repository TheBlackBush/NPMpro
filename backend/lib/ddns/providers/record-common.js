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

export {
	dotted,
	jsonHeaders,
	pathName,
	plainTarget,
	recordGone,
	refuseMultiple,
	refuseWildcard,
	relativeName,
	zoneNotFound,
};
