import { BlockList, isIP } from "node:net";

// The instance's public address, asked of echo services (spec: Public IP detection, A9). An answer counts only when it
// is a single public unicast address; a new address is written down only when a second service confirms it.

const DEFAULT_IPV4_SERVICES = ["https://api.ipify.org", "https://ipv4.icanhazip.com", "https://v4.ident.me"];
const DEFAULT_IPV6_SERVICES = ["https://api6.ipify.org", "https://ipv6.icanhazip.com", "https://v6.ident.me"];

const MAX_ADDRESS_LENGTH = 45;
const IPV6_GLOBAL_UNICAST = "2000::";
const IPV6_GLOBAL_UNICAST_BITS = 3;

const IPV4_NOT_PUBLIC = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
];
const IPV6_NOT_PUBLIC = [
	["2001:db8::", 32],
	["2001::", 32],
	["2002::", 16],
];

const ipv4Refused = new BlockList();
for (const [net, bits] of IPV4_NOT_PUBLIC) ipv4Refused.addSubnet(net, bits, "ipv4");
const ipv6Refused = new BlockList();
for (const [net, bits] of IPV6_NOT_PUBLIC) ipv6Refused.addSubnet(net, bits, "ipv6");
const ipv6Global = new BlockList();
ipv6Global.addSubnet(IPV6_GLOBAL_UNICAST, IPV6_GLOBAL_UNICAST_BITS, "ipv6");

const TRAILING_LINE_BREAK = /\r?\n$/u;
const withoutLineBreak = (text) => String(text ?? "").replace(TRAILING_LINE_BREAK, "");

/**
 * @param   {String}  text    an echo service's answer; one trailing line break is allowed
 * @param   {number}  family  4 or 6
 * @returns {boolean}  true when the text is exactly one public unicast address of that family
 */
const isPublicAddress = (text, family) => {
	const value = withoutLineBreak(text);
	if (value.length === 0 || value.length > MAX_ADDRESS_LENGTH || isIP(value) !== family) return false;
	if (family === 4) return !ipv4Refused.check(value, "ipv4");
	return !value.includes("%") && ipv6Global.check(value, "ipv6") && !ipv6Refused.check(value, "ipv6");
};

const canonical = (address, family) => (family === 6 ? new URL(`http://[${address}]`).hostname.slice(1, -1) : address);

const familyKey = (family) => (family === 6 ? "ipv6" : "ipv4");

const emptyState = () => ({ address: null, service: null, checked_on: null, error: null, error_i18n: null });

/**
 * @param   {Object}    options
 * @param   {Function}  options.fetchText  (url, family) -> Promise<String>, the body of the answer (providerFetch with
 *                                         the family pinned); a failure throws
 * @param   {Function}  options.services   () -> { ipv4: String[], ipv6: String[] }, the current lists
 * @param   {Function}  [options.log]     (message) called for a service that failed or was refused
 * @param   {Function}  [options.now]      () -> Date
 */
const createPublicIp = ({ fetchText, services, log = () => {}, now = () => new Date() }) => {
	const states = { 4: emptyState(), 6: emptyState() };
	const turn = { 4: 0, 6: 0 };

	const ask = async (url, family) => {
		let body;
		try {
			body = await fetchText(url, family);
		} catch (err) {
			log(`Public IP service ${url} failed: ${err.message}`);
			return { error: err.message };
		}
		if (!isPublicAddress(body, family)) {
			log(`Public IP service ${url} did not answer a public address`);
			return { error: `The answer is not a public IPv${family} address` };
		}
		return { address: canonical(withoutLineBreak(body), family) };
	};

	const settle = (family, patch) => {
		states[family] = { ...states[family], checked_on: now().toISOString(), ...patch };
		return states[family];
	};

	const detect = async (family) => {
		const list = services()[familyKey(family)] ?? [];
		const known = states[family].address;
		const start = list.length === 0 ? 0 : turn[family] % list.length;
		turn[family] += 1;

		let lastError = "No service is set";
		for (let step = 0; step < list.length; step++) {
			const index = (start + step) % list.length;
			const first = await ask(list[index], family);
			if (first.error) {
				lastError = first.error;
				continue;
			}
			if (first.address === known) return settle(family, { service: list[index], error: null, error_i18n: null });

			const confirmUrl = list.length > 1 ? list[(index + 1) % list.length] : null;
			const second = confirmUrl ? await ask(confirmUrl, family) : { error: "No second service" };
			if (second.error) {
				return settle(family, {
					error: "The new address was not confirmed",
					error_i18n: "error.ddns-ip-unconfirmed",
				});
			}
			if (second.address !== first.address) {
				return settle(family, { error: "The services disagree", error_i18n: "error.ddns-ip-disagree" });
			}
			return settle(family, { address: first.address, service: list[index], error: null, error_i18n: null });
		}
		return settle(family, { error: lastError, error_i18n: "error.ddns-ip-failed" });
	};

	return { detect, state: (family) => states[family] };
};

export { createPublicIp, DEFAULT_IPV4_SERVICES, DEFAULT_IPV6_SERVICES, isPublicAddress };
