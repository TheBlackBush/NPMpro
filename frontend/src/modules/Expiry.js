export const EXPIRY_WARNING_DAYS = 14;
const dayMs = 24 * 60 * 60 * 1000;

/**
 * @param {string} expiresOn ISO date from the API
 * @param {Date} [now]
 * @returns {{ state: "expired"|"soon"|"ok", days: number }}
 */
export function expiryInfo(expiresOn, now = new Date()) {
	const remaining = new Date(expiresOn).getTime() - now.getTime();
	if (remaining < 0) return { state: "expired", days: 0 };
	const days = Math.floor(remaining / dayMs);
	return { state: remaining < EXPIRY_WARNING_DAYS * dayMs ? "soon" : "ok", days };
}
