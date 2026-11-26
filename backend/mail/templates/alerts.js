/**
 * The grouped alert mail. A placeholder until Task 3.3 writes the real template: it lists the event types in order.
 *
 * @param   {Object}    input
 * @param   {Function}  input.t         translate a key
 * @param   {string}    input.instance  the instance name
 * @param   {Object}    input.data
 * @param   {Object[]}  input.data.events  the event envelopes of the group, oldest first ({ id, type, timestamp, data })
 * @returns {Object}
 */
const alerts = ({ t, data, instance }) => ({
	subject: "Alerts",
	lines: [`${data.events.length} alert(s)`],
	list: data.events.map((event) => ({ text: event.type, note: event.timestamp })),
	footer: [t("footer.sent", { instance })],
});

// direct: never queued by queueMail; the alert channel queues it with one row per event
export default Object.assign(alerts, { direct: true });
