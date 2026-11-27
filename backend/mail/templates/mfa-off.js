/**
 * The notice that two-factor sign-in was turned off for an account (queued)
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {string}    input.data.time      when it happened, as text
 * @param   {boolean}   [input.data.byAdmin] an administrator made the change
 * @returns {Object}
 */
const mfaOff = ({ t, data, instance }) => ({
	subject: t("mfa-off.subject"),
	lines: [
		t(data.byAdmin ? "mfa-off.done.admin" : "mfa-off.done", { instance, time: data.time }),
		t("account.unexpected"),
	],
	footer: [t("footer.sent", { instance })],
});

export default mfaOff;
