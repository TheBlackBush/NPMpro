import { effectiveEnv } from "./runtime-config.js";

const DEFAULT_WARNING_DAYS = 14;
const dayMs = 24 * 60 * 60 * 1000;
// Dates are stored as "YYYY-MM-DD HH:mm:ss" in the server's local time (TZ), see internal/certificate.js
const localDateTimePattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;

const toDate = (value) => {
	if (value instanceof Date) return value;
	const text = String(value);
	return new Date(localDateTimePattern.test(text) ? text.replace(" ", "T") : text);
};

/**
 * The effective warning days (setting certificates.warning_days, env CERT_WARNING_DAYS), read at call time
 *
 * @returns {number}
 */
const warningDays = () => {
	const days = Number.parseInt(effectiveEnv().CERT_WARNING_DAYS, 10);
	return Number.isInteger(days) && days >= 1 ? days : DEFAULT_WARNING_DAYS;
};

/**
 * The warning window in ms: the days, but at most a third of the certificate's lifetime (a short lived certificate
 * would otherwise be "soon" from its first day); without a usable valid-from date the days alone
 *
 * @param   {{expiresOn: Date|String, validFrom?: Date|String|null}}  dates
 * @param   {number}  [days]  default warningDays()
 * @returns {number}
 */
const windowMs = ({ expiresOn, validFrom }, days = warningDays()) => {
	const window = days * dayMs;
	if (validFrom === null || validFrom === undefined) return window;
	const lifetime = toDate(expiresOn).getTime() - toDate(validFrom).getTime();
	return lifetime > 0 ? Math.min(window, lifetime / 3) : window;
};

/**
 * @param   {{expires_on: Date|String, npmpro_valid_from?: Date|String|null}}  cert
 * @param   {Date}  [now]
 * @returns {"expired"|"soon"|"ok"}
 */
const expiryState = (cert, now = new Date()) => {
	const remaining = toDate(cert.expires_on).getTime() - now.getTime();
	if (remaining < 0) return "expired";
	if (remaining < windowMs({ expiresOn: cert.expires_on, validFrom: cert.npmpro_valid_from })) return "soon";
	return "ok";
};

export { expiryState, toDate, warningDays, windowMs };
