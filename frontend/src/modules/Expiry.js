export const EXPIRY_WARNING_DAYS = 14;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * The warning window in ms, like windowMs of backend/lib/expiry.js: the days, but at most a third of the
 * certificate's lifetime; without a usable valid-from date the days alone
 */
const windowMs = (expiresOn, validFrom, days) => {
	const window = days * dayMs;
	if (validFrom === null || validFrom === undefined) return window;
	const lifetime = new Date(expiresOn).getTime() - new Date(validFrom).getTime();
	return lifetime > 0 ? Math.min(window, lifetime / 3) : window;
};

/**
 * @param {string} expiresOn ISO date from the API
 * @param {{ validFrom?: string|null, days?: number }} [options] the certificate's valid-from date and the warning days
 * @param {Date} [now]
 * @returns {{ state: "expired"|"soon"|"ok", days: number }}
 */
export function expiryInfo(expiresOn, { validFrom, days = EXPIRY_WARNING_DAYS } = {}, now = new Date()) {
	const remaining = new Date(expiresOn).getTime() - now.getTime();
	if (remaining < 0) return { state: "expired", days: 0 };
	const left = Math.floor(remaining / dayMs);
	return { state: remaining < windowMs(expiresOn, validFrom, days) ? "soon" : "ok", days: left };
}
