/**
 * The notice that the address of an account was changed, to the old address (never naming the new one) and to the new
 * one (queued: no link)
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {string}    input.data.time   when it happened, as text
 * @param   {string}    input.data.which  "old" for the address that was replaced, "new" for the one now in use
 * @returns {Object}
 */
const addressChanged = ({ t, data, instance }) => {
	const old = data.which === "old";
	return {
		subject: t(old ? "address-changed.subject.old" : "address-changed.subject.new"),
		lines: [
			t(old ? "address-changed.old" : "address-changed.new", { instance, time: data.time }),
			t("account.unexpected"),
		],
		footer: [t("footer.sent", { instance })],
	};
};

export default addressChanged;
