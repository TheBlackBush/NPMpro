/**
 * The notice that a password was reset by a link (queued: it carries no link)
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {string}    input.data.time   when it happened, as text
 * @param   {string}    input.data.ip     the address of the request
 * @param   {number}    input.data.count  the API tokens of the user that still work
 * @returns {Object}
 */
const passwordReset = ({ t, data, instance }) => {
	const count = Number(data.count) || 0;
	const lines = [t("password-reset.done", { instance, time: data.time, ip: data.ip }), t("password-reset.sessions")];
	if (count > 0) lines.push(t(count === 1 ? "password-reset.tokens.one" : "password-reset.tokens.other", { count }));
	return { subject: t("password-reset.subject"), lines, footer: [t("footer.sent", { instance })] };
};

export default passwordReset;
