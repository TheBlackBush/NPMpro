// Which row actions a certificate offers. Pure, so node --test checks the rules without a DOM.

/**
 * @param {{ provider: string, npmproDnsChallenge?: boolean, npmproDnsProvider?: string, inUse: boolean }} row
 * @param {{ canManage: boolean }} options
 * @returns {string[]} in menu order: test, edit, renew, change-dns, download, delete
 */
export function certificateActionKeys(row, { canManage }) {
	const keys = [];
	// the HTTP challenge reachability check: only for Let's Encrypt without a DNS provider, whoever may manage
	if (row.provider === "letsencrypt" && !row.npmproDnsProvider) keys.push("test");
	if (canManage && (row.provider === "other" || row.provider === "mtls")) keys.push("edit");
	if (canManage && row.provider === "letsencrypt") keys.push("renew");
	if (canManage && row.provider === "letsencrypt" && row.npmproDnsChallenge) keys.push("change-dns");
	// the download includes the private key, so it is for managers only
	if (canManage) keys.push("download");
	if (canManage && !row.inUse) keys.push("delete");
	return keys;
}
