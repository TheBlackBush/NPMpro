/**
 * Whether the UI has to tell the server the language it shows: the signed-in user is loaded and the stored language
 * (the one mails go out in) differs from the UI language
 *
 * @param   {Object|undefined}  user    the user of /users/me, undefined while loading
 * @param   {string}            locale  the UI language code
 * @returns {boolean}
 */
const languageNeedsSync = (user, locale) => Boolean(user) && user.npmproLanguage !== locale;

export { languageNeedsSync };
