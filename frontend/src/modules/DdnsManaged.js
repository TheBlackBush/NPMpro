// The rows the host record option makes in the Dynamic DNS list (backend/internal/host-dns-record.js): a record that
// belongs to a host is read-only here, and one whose delete at the provider failed (an orphan) can be deleted there
// again or forgotten. Pure; the list and the record window only draw it.

// the host_type of a record answer and the host window that edits it
const HOST_KINDS = { proxy_host: "proxy", redirection_host: "redirection", dead_host: "dead" };

/** Whether the record belongs to a host (made by the host record option) */
export const isManagedRecord = (record) => typeof record?.hostType === "string" && record.hostType !== "";

/** Whether the record is a host's record whose delete at the provider failed */
export const isOrphanRecord = (record) => isManagedRecord(record) && record.orphan === true;

/**
 * The host of a managed record, when the user may see it: its window type, id and label (the host's first name). A
 * record without a host_label (a host the user may not see) has none, so no link is offered.
 *
 * @param   {Object|null|undefined} record  a record of GET /nginx/ddns-records (camelCase)
 * @returns {{ type: "proxy"|"redirection"|"dead", id: number, label: string }|null}
 */
export function hostOfRecord(record) {
	if (!isManagedRecord(record)) return null;
	const type = HOST_KINDS[record.hostType];
	if (!type || !Number.isInteger(record.hostId) || typeof record.hostLabel !== "string" || record.hostLabel === "") {
		return null;
	}
	return { type, id: record.hostId, label: record.hostLabel };
}

/**
 * The menu items of a row, in order. A manual row keeps the whole menu; a managed row has no Edit (the window opens
 * view-only), Disable or Delete; an orphan adds the two ways out.
 *
 * @param   {Object} record  a record of the list (camelCase)
 * @param   {{ canManage: boolean }} rights  canManage: the user may edit this kind of record (Certificates manage; a
 *          custom record only for administrators)
 * @returns {string[]}  keys: edit, open-host, update-now, history, toggle, remove-at-provider, forget, delete
 */
export function rowActionKeys(record, { canManage }) {
	if (!isManagedRecord(record)) {
		const keys = ["edit"];
		if (canManage && record.enabled) keys.push("update-now");
		keys.push("history");
		if (canManage) keys.push("toggle", "delete");
		return keys;
	}
	const keys = ["edit"];
	if (hostOfRecord(record)) keys.push("open-host");
	if (canManage && record.enabled && !isOrphanRecord(record)) keys.push("update-now");
	keys.push("history");
	if (canManage && isOrphanRecord(record)) keys.push("remove-at-provider", "forget");
	return keys;
}
