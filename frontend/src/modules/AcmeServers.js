// The CA choices of the certificate windows (create and re-issue). Pure, so node --test checks it without a DOM.
import { ACME_PRESETS, acmeServerLabel, serverKey } from "./AcmeAccount.js";

// a CA without a registered account registers at its first request, or the request is refused with a clear message
const notConnected = (server) => server.state === "failed" || server.state === "none";

/** The CA select shows only when there is a choice: more than one CA */
export const showCaSelect = (servers) => Array.isArray(servers) && servers.length > 1;

/** The CA that issues by default: the instance CA, the first of the list */
export const defaultCa = (servers) => servers?.find((server) => server.instance)?.server ?? "";

/**
 * The options of the CA select: the label (labelId of a preset or the host text), whether it is the default CA and
 * whether it is not connected yet or waiting (not reachable yet); `exclude` leaves one CA out (the certificate's current CA)
 *
 * @param {{ server: string, state: string, instance: boolean }[]} servers
 * @param {string} [exclude]
 */
export const caOptions = (servers, exclude) =>
	(servers ?? [])
		// the same CA in another spelling is the same CA (serverKey, as the backend compares)
		.filter((server) => !(exclude && serverKey(server.server) === serverKey(exclude)))
		.map((server) => ({
			value: server.server,
			...acmeServerLabel(server.server),
			isDefault: server.instance,
			notConnected: notConnected(server),
			// the CA did not answer at the last try: a request at it likely fails
			waiting: server.state === "pending",
		}));

/** The CA the re-issue window warns about: a test CA, whose certificates browsers do not trust (Let's Encrypt staging) */
const TEST_CA = serverKey(ACME_PRESETS.find((preset) => preset.id === "letsencrypt-staging").server);
export const isTestCa = (server) => Boolean(server) && serverKey(server) === TEST_CA;

/**
 * The texts of one select option (caOptions): its label, "(default)" on the instance CA, and the second line of a CA
 * that waits (not reachable yet) or is not connected yet. format(id, values) turns a message id into its text.
 *
 * @param {{ value: string, labelId?: string, text?: string, isDefault: boolean, waiting: boolean, notConnected: boolean }} option
 * @param {(id: string, values?: Object) => string} format
 */
export const caOptionTexts = (option, format) => {
	const name = option.labelId ? format(option.labelId) : option.text;
	let description;
	if (option.waiting) description = format("certificates.ca.waiting");
	else if (option.notConnected) description = format("certificates.ca.not-connected");
	return {
		value: option.value,
		label: option.isDefault ? format("certificates.ca.default", { name }) : name,
		description,
	};
};
