import * as api from "./base";

export async function getAuditLogs(expand, params = {}) {
	return await api.get({
		url: "/audit-log",
		params: {
			expand: expand?.join(","),
			...params,
		},
	});
}

export async function getAuditLogsPage(expand, params = {}) {
	return await api.getWithTotal({
		url: "/audit-log",
		params: {
			expand: expand?.join(","),
			...params,
		},
	});
}
