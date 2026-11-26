import { isSingleAddress, MAIL_LANGUAGES } from "./settings-rules.js";

const languageOf = (candidate, fallback) => (MAIL_LANGUAGES.includes(candidate) ? candidate : fallback);

const isAdmin = (user) => Array.isArray(user?.roles) && user.roles.includes("admin");

/**
 * The people an alert mail goes to: the enabled administrators with a valid address (when `alerts_admins` is on) and
 * the listed addresses, one entry per address (compared in lower case). An administrator's own language wins over the
 * default language a listed address gets. A disabled user and an invalid address get nothing.
 *
 * @param   {Object}    options
 * @param   {Object[]}  options.admins    users { email, roles, is_disabled, npmpro_language }
 * @param   {Object}    options.settings  the notification settings { alerts_admins, alerts_addresses, default_language }
 * @returns {{address: string, language: string}[]}
 */
const alertRecipients = ({ admins, settings }) => {
	const fallback = languageOf(settings?.default_language, "en");
	const found = new Map();
	const add = (address, language) => {
		if (!isSingleAddress(address)) return;
		const key = address.toLowerCase();
		if (!found.has(key)) found.set(key, { address, language });
	};
	if (settings?.alerts_admins === true) {
		for (const user of admins ?? []) {
			if (isAdmin(user) && !user.is_disabled) add(user.email, languageOf(user.npmpro_language, fallback));
		}
	}
	for (const address of settings?.alerts_addresses ?? []) add(address, fallback);
	return [...found.values()];
};

export { alertRecipients };
