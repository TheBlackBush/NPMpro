/**
 * The notice that the password of an account was changed (queued: it carries no link, no password)
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {string}    input.data.time      when it happened, as text
 * @param   {boolean}   [input.data.byAdmin] an administrator made the change
 * @returns {Object}
 */
const passwordChanged = ({ t, data, instance }) => ({
	subject: t("password-changed.subject"),
	lines: [
		t(data.byAdmin ? "password-changed.done.admin" : "password-changed.done", { instance, time: data.time }),
		t("password-changed.sessions"),
		t("account.unexpected"),
	],
	footer: [t("footer.sent", { instance })],
});

export default passwordChanged;
