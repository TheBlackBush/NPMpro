import { isIP } from "node:net";

// Where one host name points: the pure rules of the host check. The lookups, the public addresses and the provider
// read are passed in (lookup, publicIp, coverage), so nothing here touches the network.
//
// States: here (via dns, record, alias or wildcard; proxied when the provider record is proxied), partly (one address
// family here, the other elsewhere), elsewhere, none (no A and no AAAA), unknown (reason says why), skipped.

const HOSTNAME = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?)*$/u;
const NOT_ANSWERS = new Set(["nodata", "nxdomain"]);

/** an IPv6 address in one form, so two spellings compare equal */
const canonical = (address) => {
	if (typeof address !== "string") return address;
	return isIP(address) === 6 ? new URL(`http://[${address}]`).hostname.slice(1, -1) : address;
};

const hasAddress = (values, address) =>
	typeof address === "string" && values.some((value) => canonical(value) === canonical(address));

const answer = (name, state, extra = {}) => ({
	name,
	state,
	via: null,
	proxied: false,
	ipv4: { found: [], public: null },
	ipv6: { found: [], public: null },
	reason: null,
	message: null,
	...extra,
});

/**
 * @param   {Object}    options
 * @param   {String}    options.name
 * @param   {Object}    options.publicIp  { ipv4: String|null, ipv6: () => Promise<String|null> } (the IPv6 is asked
 *                                        only when the name has AAAA records)
 * @param   {Function}  options.lookup    (name, type) -> { ok, values } | { ok: false, code }
 * @param   {Function}  options.coverage  (name, { dnsHere }) -> null (no provider read) or { record, wildcard,
 *                                        alias, error }: record { values, proxied } | null, wildcard { name, values,
 *                                        proxied } | null, error a scrubbed message when the read failed
 * @returns {Promise<Object>}  { name, state, via, proxied, ipv4: { found, public }, ipv6: { found, public },
 *                             reason, message }
 */
const checkInner = async ({ name, publicIp, lookup, coverage }) => {
	if (!HOSTNAME.test(name)) return answer(name, "skipped", { reason: "skipped-pattern" });

	const [a, aaaa] = await Promise.all([lookup(name, "A"), lookup(name, "AAAA")]);
	for (const result of [a, aaaa]) {
		if (!result.ok && !NOT_ANSWERS.has(result.code)) {
			return answer(name, "unknown", { reason: `lookup-${result.code}` });
		}
	}
	const found4 = a.ok ? a.values : [];
	const found6 = aaaa.ok ? aaaa.values : [];
	const ip4 = publicIp.ipv4 ?? null;
	const ip6 = found6.length > 0 ? ((await publicIp.ipv6()) ?? null) : null;
	const base = { ipv4: { found: found4, public: ip4 }, ipv6: { found: found6, public: ip6 } };

	if (found4.length === 0 && found6.length === 0 && ip4 === null) return answer(name, "none", base);
	if (ip4 === null) return answer(name, "unknown", { ...base, reason: "public-address-unknown" });

	const dns4 = hasAddress(found4, ip4);
	const dns6 = hasAddress(found6, ip6);
	const dnsHere = dns4 && (found6.length === 0 || dns6);
	const cover = await coverage(name, { dnsHere });

	let via = "dns";
	let here4 = dns4;
	let proxied = false;
	let foundByProvider = [];
	if (cover?.record) {
		foundByProvider = cover.record.values;
		if (hasAddress(cover.record.values, ip4)) {
			here4 = true;
			via = "record";
			proxied = cover.record.proxied === true;
		}
	} else if (cover?.alias) {
		// a record that is a CNAME (a flattened proxied name): its target counts, one level
		const { alias } = cover;
		const viaLookup = await lookup(alias.target, "A");
		const values = alias.own?.values ?? (viaLookup.ok ? viaLookup.values : []);
		foundByProvider = values;
		if (hasAddress(values, ip4) || (viaLookup.ok && hasAddress(viaLookup.values, ip4))) {
			here4 = true;
			via = "alias";
			proxied = alias.proxied === true;
		}
	} else if (cover?.wildcard) {
		foundByProvider = cover.wildcard.values;
		if (hasAddress(cover.wildcard.values, ip4)) {
			here4 = true;
			via = "wildcard";
			proxied = cover.wildcard.proxied === true;
		}
	}
	const providerNote = cover?.error ? { reason: "provider-read-failed", message: cover.error } : {};
	if (found4.length === 0) base.ipv4.found = foundByProvider;

	// a proxied record answers with the provider's own AAAA too: the family says nothing about this instance
	const considerSix = found6.length > 0 && !proxied;
	if (considerSix && ip6 === null) return answer(name, "unknown", { ...base, reason: "public-ipv6-unknown" });
	const here6 = !considerSix || dns6;

	if (cover?.error && !here4) return answer(name, "unknown", { ...base, ...providerNote });
	if (here4 && here6) return answer(name, "here", { ...base, via, proxied, ...providerNote });
	if (here4 !== here6 && (here4 || (considerSix && dns6))) {
		return answer(name, "partly", { ...base, via: here4 ? via : "dns", proxied, ...providerNote });
	}
	if (base.ipv4.found.length === 0 && found6.length === 0) return answer(name, "none", { ...base, ...providerNote });
	return answer(name, "elsewhere", { ...base, ...providerNote });
};

/**
 * checkInner, with a failure of any injected function kept to this name: it answers unknown (reason check-failed, no
 * text) and calls onError with the error
 */
const checkName = async (options) => {
	try {
		return await checkInner(options);
	} catch (error) {
		options.onError?.(error);
		return answer(options.name, "unknown", { reason: "check-failed" });
	}
};

export { canonical, checkName, hasAddress };
