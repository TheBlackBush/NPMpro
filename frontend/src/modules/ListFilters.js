import { expiryInfo } from "./Expiry.js";

const STATUSES = ["online", "error", "disabled"];
const TLS = ["with", "without"];

/**
 * @param {URLSearchParams} searchParams
 * @param {{ groups?: string[] }} [allowed]
 */
export function parseFilters(searchParams, allowed = {}) {
	const pick = (key, values) => {
		const value = searchParams.get(key);
		return values.includes(value) ? value : "all";
	};
	const group = searchParams.get("group");
	return {
		q: searchParams.get("q") ?? "",
		status: pick("status", STATUSES),
		tls: pick("tls", TLS),
		group: group && (allowed.groups ?? []).includes(group) ? group : null,
		expiry: pick("expiry", ["soon"]),
	};
}

export function hostStatus(row) {
	if (!row.enabled) return "disabled";
	if (row.npmplusNginxOnline === false) return "error";
	return "online";
}

const matchesSearch = (row, q, searchText) => {
	const needle = q.trim().toLowerCase();
	return needle === "" || searchText(row).toLowerCase().includes(needle);
};

export function filterHosts(rows, filters, { searchText, getGroup }) {
	return rows.filter((row) => {
		if (!matchesSearch(row, filters.q, searchText)) return false;
		if (filters.status !== "all" && hostStatus(row) !== filters.status) return false;
		if (filters.tls === "with" && !row.certificate) return false;
		if (filters.tls === "without" && row.certificate) return false;
		if (filters.group !== null && (getGroup(row) ?? "") !== filters.group) return false;
		return true;
	});
}

export function filterCertificates(rows, filters, { searchText, now = new Date() }) {
	return rows.filter((row) => {
		if (!matchesSearch(row, filters.q, searchText)) return false;
		if (filters.expiry === "soon") {
			if (row.provider === "mtls" || !row.expiresOn) return false;
			if (expiryInfo(row.expiresOn, now).state === "ok") return false;
		}
		return true;
	});
}

export function activeFilterCount(filters, kinds = ["status", "tls", "group", "expiry"]) {
	let count = 0;
	if (filters.q.trim() !== "") count++;
	if (kinds.includes("status") && filters.status !== "all") count++;
	if (kinds.includes("tls") && filters.tls !== "all") count++;
	if (kinds.includes("group") && filters.group !== null) count++;
	if (kinds.includes("expiry") && filters.expiry !== "all") count++;
	return count;
}
