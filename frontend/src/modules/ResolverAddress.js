import { isIPv4, isIPv6 } from "./RuntimeSettings.js";
import { isNginxTime } from "./SettingsForms.js";

// the nginx resolver's DNS servers, the backend's rules (lib/resolver-address.js, lib/runtime-rule-table.js)
export const MAX_RESOLVER_ADDRESSES = 8;
const ADDRESS = /^(?<host>[0-9]{1,3}(?:\.[0-9]{1,3}){3}|\[[0-9A-Fa-f:.]+\])(?::(?<port>[0-9]{1,5}))?$/u;

/**
 * One DNS server address: an IPv4 address or an IPv6 address in brackets, with an optional port; no host name and no
 * bare IPv6 address
 *
 * @param   {string}  text
 * @returns {boolean}
 */
export const isResolverAddress = (text) => {
	const groups = typeof text === "string" ? ADDRESS.exec(text)?.groups : undefined;
	if (!groups) return false;
	const { host, port } = groups;
	if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return false;
	return host.startsWith("[") ? isIPv6(host.slice(1, -1)) : isIPv4(host);
};

/**
 * The first problem of an address list, or null: { error: "list" } (not a list), { error: "too-many" },
 * { error: "invalid", address } or { error: "duplicate", address }
 *
 * @param   {string[]}  list
 * @returns {{ error: string, address?: string } | null}
 */
export const resolverAddressProblem = (list) => {
	if (!Array.isArray(list)) return { error: "list" };
	if (list.length > MAX_RESOLVER_ADDRESSES) return { error: "too-many" };
	const bad = list.find((entry) => !isResolverAddress(entry));
	if (bad !== undefined) return { error: "invalid", address: bad };
	const duplicate = list.find((entry, index) => list.indexOf(entry) !== index);
	return duplicate === undefined ? null : { error: "duplicate", address: duplicate };
};

/**
 * The resolver's valid= value: empty (the TTL of each answer), a bare number other than 0, or ordered parts with the
 * units y M w d h m s, at most 32 characters; never ms (nginx refuses it there) and not the general nginx time rule
 *
 * @param   {string}  value
 * @returns {boolean}
 */
export const isResolverValid = (value) =>
	typeof value === "string" && (value === "" || (isNginxTime(value) && value !== "0" && !value.includes("ms")));

/**
 * The resolver fields' errors, as the nginx form validate gives them
 *
 * @param   {Object}  rules   Validations
 * @param   {Object}  values  form values
 * @returns {Object}
 */
export const resolverValidate = (rules, values) => {
	const errors = {};
	const problem = resolverAddressProblem(values.resolverAddresses ?? []);
	if (problem?.error === "too-many") {
		errors.resolverAddresses = rules.message("settings.nginx.resolver.too-many");
	} else if (problem) {
		errors.resolverAddresses = rules.message("settings.nginx.resolver.invalid", { address: problem.address ?? "" });
	}
	if (!isResolverValid(String(values.resolverValid ?? "").trim())) {
		errors.resolverValid = rules.message("settings.nginx.resolver.valid.invalid");
	}
	return errors;
};
