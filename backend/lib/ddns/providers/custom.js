import { checkUrlShape, fillUrl } from "../custom-url.js";
import { EngineFailure } from "../engine-failure.js";
import { DdnsProviderError } from "../errors.js";

/**
 * The custom HTTP provider (administrators only): one request to the URL the administrator saved, with the
 * placeholders filled. Like DuckDNS it has no zones and no read: the engine writes when the DNS answer differs. The
 * URL travels as the record's sealed secret; every call gets it as a secret, so no message can show it.
 */
export default {
	id: "custom",
	label: "Custom HTTP",
	credentialProvider: null,
	recordTypes: ["A", "AAAA"],
	proxied: false,
	ipv6: true,
	adminOnly: true,
	wildcards: false,
	aliases: false,
	zoneless: true,
	read: () => Promise.resolve(null),
	/** One GET or POST: a 2xx answer that holds the expected text (when one is set) is a success */
	async write({ name, type, ip, fields, fetch, meta }) {
		const { url, method, expect } = fields;
		if (typeof url !== "string" || url === "") {
			throw new EngineFailure("Enter the URL again", "error.ddns-custom-url-missing");
		}
		if (checkUrlShape(url).key) {
			throw new DdnsProviderError({ code: "not-https", message: "The saved URL is not valid", retry: false });
		}
		const res = await fetch(fillUrl(url, { ip, type, name }), { method: method === "POST" ? "POST" : "GET" });
		if (res.status < 200 || res.status >= 300) {
			throw new DdnsProviderError({
				providerStatus: res.status,
				code: "failed",
				message: `The URL answered HTTP ${res.status}`,
				retry: res.status >= 500,
			});
		}
		if (typeof expect === "string" && expect !== "" && !res.text.includes(expect)) {
			throw new DdnsProviderError({
				providerStatus: res.status,
				code: "failed",
				message: "The answer did not contain the expected text",
			});
		}
		return { meta: { ...meta }, created: false };
	},
};
