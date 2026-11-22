// The tabs of the Certificates page, as links (each tab is its own route). Pure, so node --test checks them.

export const CERTIFICATE_TABS = Object.freeze([
	Object.freeze({ key: "certificates", to: "/certificates", labelId: "certificates" }),
	Object.freeze({ key: "dns-credentials", to: "/certificates/dns-credentials", labelId: "dns-credentials" }),
	Object.freeze({ key: "domains", to: "/certificates/domains", labelId: "dns-domains" }),
]);

const DNS_CREDENTIALS_PATH = /^\/certificates\/dns-credentials(?:\/|$)/u;
const DOMAINS_PATH = /^\/certificates\/domains(?:\/|$)/u;

/** The tab a path opens: DNS Credentials on its route (with or without a trailing part), else Certificates */
export function certificateTab(pathname) {
	if (DNS_CREDENTIALS_PATH.test(pathname)) return "dns-credentials";
	return DOMAINS_PATH.test(pathname) ? "domains" : "certificates";
}

// The expand lists of the tab pages. The tabs read their counts with the same lists, so the open page's request
// is shared from the query cache.
export const CERTIFICATE_LIST_EXPAND = Object.freeze([
	"owner",
	"dead_hosts",
	"proxy_hosts",
	"redirection_hosts",
	"streams",
	"mtls_dead_hosts",
	"mtls_proxy_hosts",
	"mtls_redirection_hosts",
	"mtls_streams",
]);
export const DNS_CREDENTIAL_LIST_EXPAND = Object.freeze(["owner", "certificates", "domains"]);
export const DNS_DOMAIN_LIST_EXPAND = Object.freeze(["credential"]);
