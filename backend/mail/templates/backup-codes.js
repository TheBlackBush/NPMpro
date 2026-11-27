/**
 * The notice that new backup codes were made for an account (queued; the codes are never in it)
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {string}    input.data.time      when it happened, as text
 * @param   {boolean}   [input.data.byAdmin] an administrator made the change
 * @returns {Object}
 */
const backupCodes = ({ t, data, instance }) => ({
	subject: t("backup-codes.subject"),
	lines: [
		t(data.byAdmin ? "backup-codes.done.admin" : "backup-codes.done", { instance, time: data.time }),
		t("backup-codes.old"),
		t("account.unexpected"),
	],
	footer: [t("footer.sent", { instance })],
});

export default backupCodes;
