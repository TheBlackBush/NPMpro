/**
 * The invitation to a new account, sent at once by sendNow (a link never goes into the delivery queue)
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {string}    input.data.link  the link that opens the page where the password is chosen
 * @returns {Object}
 */
const invite = ({ t, data, instance }) => ({
	subject: t("invite.subject"),
	lines: [t("invite.intro", { instance }), t("invite.expires"), t("invite.ignore")],
	button: { label: t("invite.button"), url: data.link },
	footer: [t("footer.sent", { instance })],
});

// direct: sent at once by sendNow, never queued
export default Object.assign(invite, { direct: true });
