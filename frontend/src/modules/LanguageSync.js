/**
 * Whether the UI has to tell the server the language it shows: the signed-in user is loaded and the stored language
 * (the one mails go out in) differs from the UI language
 *
 * @param   {Object|undefined}  user    the user of /users/me, undefined while loading
 * @param   {string}            locale  the UI language code
 * @returns {boolean}
 */
const languageNeedsSync = (user, locale) => Boolean(user) && user.npmproLanguage !== locale;

/**
 * One sync per page load: the returned function sends the language at most once, when the user is loaded and the
 * stored language differs. A failed send is not repeated (the next page load tries again) and shows nothing.
 *
 * @param   {string}                         locale  the UI language code
 * @param   {(language: string) => Promise}  send    the PUT of the language
 * @returns {(user: Object|undefined) => void}
 */
const createLanguageSync = (locale, send) => {
	let sent = false;
	return (user) => {
		if (sent || !languageNeedsSync(user, locale)) return;
		sent = true;
		send(locale).catch(() => undefined);
	};
};

export { createLanguageSync, languageNeedsSync };
