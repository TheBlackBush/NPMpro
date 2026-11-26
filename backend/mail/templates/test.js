/**
 * The test mail of Settings, Notifications
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @returns {Object}
 */
export default ({ t, instance }) => ({
	subject: t("test.subject"),
	lines: [t("test.intro", { instance }), t("test.works")],
	footer: [t("footer.sent", { instance })],
});
