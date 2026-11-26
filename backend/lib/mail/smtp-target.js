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

// the resolver says the name does not exist (or has no address): a settings problem, not a passing outage
const NO_SUCH_NAME = new Set(["ENOTFOUND", "ENODATA"]);

const unresolved = (name) => mailError("mail-host-unresolved", `${name} does not resolve`);

// a resolver outage (EAI_AGAIN, a timeout, SERVFAIL, a refused query): the send may be tried again later
const lookupFailed = (name, err) =>
	Object.assign(mailError("mail-host-lookup-failed", `${name} could not be looked up (${err?.code ?? "error"})`), {
		temporary: true,
	});

/**
 * Resolves the SMTP host and refuses it when any address is blocked, when a name does not resolve, or when a login
 * would travel in plain text to an address that is not a private LAN address. The caller connects to the returned
 * address, never to a second answer of the resolver.
 *
 * @param   {Object}  target
 * @param   {String}  target.host
 * @param   {String}  target.security  starttls, tls or none
 * @param   {String}  [target.username]
 * @returns {Promise<{address: String, family: Number, addresses: Object[]}>}  the first address and the whole checked list
 */
const checkSmtpTarget = async ({ host, security, username }) => {
	const name = String(host ?? "").replace(BRACKETS, "");
	let addresses;
	if (isIP(name) === 0) {
		try {
			addresses = await lookupAll(name);
		} catch (err) {
			throw NO_SUCH_NAME.has(err?.code) ? unresolved(name) : lookupFailed(name, err);
		}
		if (addresses.length === 0) throw unresolved(name);
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
	// IPv4 first (the sort is stable); every address in the list was checked above
	const ordered = [...addresses].sort((a, b) => a.family - b.family);
	return { address: ordered[0].address, family: ordered[0].family, addresses: ordered };
};

export { checkSmtpTarget };
