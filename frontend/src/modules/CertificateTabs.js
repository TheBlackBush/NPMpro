// The two tabs of the Certificates page, as links (each tab is its own route). Pure, so node --test checks them.

export const CERTIFICATE_TABS = Object.freeze([
	Object.freeze({ key: "certificates", to: "/certificates", labelId: "certificates" }),
	Object.freeze({ key: "dns-credentials", to: "/certificates/dns-credentials", labelId: "dns-credentials" }),
]);

/** The tab a path opens: DNS Credentials on its route (with or without a trailing part), else Certificates */
export function certificateTab(pathname) {
	return /^\/certificates\/dns-credentials(\/|$)/u.test(pathname) ? "dns-credentials" : "certificates";
}
