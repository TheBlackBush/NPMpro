/**
 * Whether the UI has to tell the server the language the user chose: a language was chosen (never the English
 * fallback of a user who did not choose, whose mails then use the default mail language), the signed-in user is loaded
 * and the stored language (the one mails go out in) differs
 *
 * @param   {Object|undefined}  user    the user of /users/me, undefined while loading
 * @param   {string|null}       locale  the chosen UI language code, null when none was chosen
 * @returns {boolean}
 */
const languageNeedsSync = (user, locale) => Boolean(locale) && Boolean(user) && user.npmproLanguage !== locale;

/**
 * One sync per page load: the returned function sends the language at most once, when the user is loaded and the
 * stored language differs. A failed send is not repeated (the next page load tries again) and shows nothing.
 *
 * @param   {string|null}                    locale  the chosen UI language code, null when none was chosen
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
