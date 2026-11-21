// The CA choices of the certificate windows (create and re-issue). Pure, so node --test checks it without a DOM.
import { acmeServerLabel, serverKey } from "./AcmeAccount.js";

// a CA without a registered account registers at its first request, or the request is refused with a clear message
const notConnected = (server) => server.state === "failed" || server.state === "none";

/** The CA select shows only when there is a choice: more than one CA */
export const showCaSelect = (servers) => Array.isArray(servers) && servers.length > 1;

/** The CA that issues by default: the instance CA, the first of the list */
export const defaultCa = (servers) => servers?.find((server) => server.instance)?.server ?? "";

/**
 * The options of the CA select: the label (labelId of a preset or the host text), whether it is the default CA and
 * whether it is not connected yet; `exclude` leaves one CA out (the certificate's current CA)
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
		}));
