import { isIP } from "node:net";
import { isBlockedAddress, isPrivateLanAddress } from "../blocked-address.js";
import { blockedError, lookupAll } from "../outbound-guard.js";

const BRACKETS = /^\[|\]$/gu;
const LOOPBACK_V4 = /^127\./u;

/**
 * The test hook (like NPMPRO_TEST_ARGON2): loopback addresses pass so the API tests can reach the fake SMTP server;
 * it counts only together with the tests' temporary root, so it is inert in the image
 *
 * @param   {String}  address
 * @returns {Boolean}
 */
const isTestLoopback = (address) =>
	Boolean(process.env.NPMPRO_TEST_ROOT) &&
	process.env.NPMPRO_TEST_SMTP === "loopback" &&
	(LOOPBACK_V4.test(address) || address === "::1");

const refusedAddress = (address) => isBlockedAddress(address) && !isTestLoopback(address);

const mailError = (code, message) => Object.assign(new Error(message), { code, message_i18n: `error.${code}` });

/**
 * Resolves the SMTP host and refuses it when any address is blocked, when a name does not resolve, or when a login
 * would travel in plain text to an address that is not a private LAN address. The caller connects to the returned
 * address, never to a second answer of the resolver.
 *
 * @param   {Object}  target
 * @param   {String}  target.host
 * @param   {String}  target.security  starttls, tls or none
 * @param   {String}  [target.username]
 * @returns {Promise<{address: String, family: Number}>}
 */
const checkSmtpTarget = async ({ host, security, username }) => {
	const name = String(host ?? "").replace(BRACKETS, "");
	let addresses;
	if (isIP(name) === 0) {
		try {
			addresses = await lookupAll(name);
		} catch {
			throw mailError("mail-host-unresolved", `${name} does not resolve`);
		}
		if (addresses.length === 0) throw mailError("mail-host-unresolved", `${name} does not resolve`);
	} else {
		addresses = [{ address: name, family: isIP(name) }];
	}
	if (addresses.some(({ address }) => refusedAddress(address))) throw blockedError(name);
	if (
		security === "none" &&
		username &&
		addresses.some(({ address }) => !isPrivateLanAddress(address) && !isTestLoopback(address))
	) {
		throw mailError("mail-plain-credentials", "A login is not sent in plain text to a non-private address");
	}
	return { address: addresses[0].address, family: addresses[0].family };
};

export { checkSmtpTarget };
