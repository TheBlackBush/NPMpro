/**
 * The password reset link, sent at once by sendNow (a link never goes into the delivery queue)
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {string}    input.data.link  the reset link
 * @returns {Object}
 */
const resetLink = ({ t, data, instance }) => ({
	subject: t("reset-link.subject"),
	lines: [t("reset-link.intro", { instance }), t("reset-link.expires"), t("reset-link.ignore")],
	button: { label: t("reset-link.button"), url: data.link },
	footer: [t("footer.sent", { instance })],
});

// direct: sent at once by sendNow, never queued
export default Object.assign(resetLink, { direct: true });
