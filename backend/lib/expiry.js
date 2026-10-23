const EXPIRY_WARNING_DAYS = 14;
const dayMs = 24 * 60 * 60 * 1000;
// Dates are stored as "YYYY-MM-DD HH:mm:ss" in the server's local time (TZ), see internal/certificate.js
const localDateTimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;

const toDate = (value) => {
	if (value instanceof Date) return value;
	const text = String(value);
	return new Date(localDateTimePattern.test(text) ? text.replace(" ", "T") : text);
};

/**
 * @param   {Date|String}  expiresOn
 * @param   {Date}         [now]
 * @returns {"expired"|"soon"|"ok"}
 */
const expiryState = (expiresOn, now = new Date()) => {
	const remaining = toDate(expiresOn).getTime() - now.getTime();
	if (remaining < 0) return "expired";
	if (remaining < EXPIRY_WARNING_DAYS * dayMs) return "soon";
	return "ok";
};

/**
 * @param   {Date}  [now]
 * @returns {{ now: Date, soon: Date }}
 */
const expiryBounds = (now = new Date()) => ({ now, soon: new Date(now.getTime() + EXPIRY_WARNING_DAYS * dayMs) });

export { EXPIRY_WARNING_DAYS, expiryBounds, expiryState };
