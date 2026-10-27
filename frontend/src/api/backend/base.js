import { QueryClient } from "@tanstack/react-query";
import queryString from "query-string";
import AuthStore from "src/modules/AuthStore";
import { camelizeKeys, decamelizeKeys } from "./caseConvert";

export const queryClient = new QueryClient();
const contentTypeHeader = "Content-Type";

function buildUrl({ url, params }) {
	const endpoint = url.slice(1);
	const baseUrl = `/api/${endpoint}`;
	const apiUrl = queryString.stringifyUrl({
		url: baseUrl,
		query: params,
	});
	return apiUrl;
}

// maps keyed by backup type id, certificate provider or item key: their keys are data and stay as they are
// (items: type ids, choices: keys like "proxy_hosts:3" or "file:custom_nginx/MyFile.conf")
export const BACKUP_RAW_KEYS = ["counts", "certificate_kinds", "certificateKinds", "items", "choices"];

function buildBody(data, url) {
	const isBackupApi = typeof url === "string" && url.startsWith("/backups");
	return JSON.stringify(decamelizeKeys(data, isBackupApi ? { rawKeys: BACKUP_RAW_KEYS } : undefined));
}

function camelizeResponse(payload, responseUrl) {
	const isBackupApi =
		typeof responseUrl === "string" &&
		new URL(responseUrl, window.location.origin).pathname.startsWith("/api/backups");
	return camelizeKeys(payload, isBackupApi ? { rawKeys: BACKUP_RAW_KEYS } : undefined);
}

function logoutOnUnauthorized(reload) {
	// Force logout user and reload the page if Unauthorized
	AuthStore.clear();
	queryClient.clear();
	if (reload) {
		window.location.reload();
	}
}

async function processResponse(response, reload = true) {
	let payload = {};
	try {
		payload = await response.json();
	} catch (err) {
		if (response.ok) throw err;
	}
	if (!response.ok) {
		if (response.status === 401) logoutOnUnauthorized(reload);
		const error = new Error(payload.error?.message_i18n ?? payload.error?.message ?? `HTTP ${response.status}`);
		error.payload = payload;
		throw error;
	}
	return camelizeResponse(payload, response.url);
}

/**
 * Parses an XMLHttpRequest response like processResponse. A non-2xx answer that is not JSON (for example the
 * 413 page of nginx) becomes an error with a translation id, so the caller never sees a JSON.parse failure.
 */
function processXhr(xhr, reload = true) {
	let payload = null;
	try {
		payload = JSON.parse(xhr.responseText);
	} catch {
		// not JSON, handled below
	}
	if (xhr.status >= 200 && xhr.status < 300) {
		if (payload === null) throw new Error("error.request-failed");
		return camelizeResponse(payload, xhr.responseURL);
	}
	if (xhr.status === 401) logoutOnUnauthorized(reload);
	let error;
	if (payload && typeof payload === "object" && payload.error) {
		error = new Error(payload.error.message_i18n ?? payload.error.message ?? `HTTP ${xhr.status}`);
		error.payload = payload;
	} else {
		error = new Error(`HTTP ${xhr.status}`);
		const message_i18n = xhr.status === 413 ? "backup.error.too-large" : "error.request-failed";
		error.payload = { error: { message_i18n, message: error.message } };
	}
	throw error;
}

/**
 * POSTs a file as the raw body (application/octet-stream) and reports the upload progress as a fraction 0..1.
 * There is no size check on the client: the server limit applies.
 */
export function upload({ url, params, file, onProgress, reload }, abortController) {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", buildUrl({ url, params }));
		xhr.withCredentials = true;
		xhr.setRequestHeader(contentTypeHeader, "application/octet-stream");
		if (onProgress) {
			xhr.upload.addEventListener("progress", (event) => {
				if (event.lengthComputable) onProgress(event.loaded / event.total);
			});
		}
		xhr.addEventListener("load", () => {
			try {
				resolve(processXhr(xhr, reload));
			} catch (err) {
				reject(err);
			}
		});
		xhr.addEventListener("error", () => reject(new Error("error.request-failed")));
		xhr.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
		abortController?.signal.addEventListener("abort", () => xhr.abort());
		xhr.send(file);
	});
}

export async function get({ url, params, reload }, abortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "GET";
	const signal = abortController?.signal;
	const response = await fetch(apiUrl, { method, signal });
	return processResponse(response, reload);
}

export async function getWithTotal({ url, params, reload }, abortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "GET";
	const signal = abortController?.signal;
	const response = await fetch(apiUrl, { method, signal });
	const header = response.headers.get("X-Total-Count");
	const parsed = header === null ? Number.NaN : Number.parseInt(header, 10);
	const total = Number.isNaN(parsed) ? null : parsed;
	return { data: await processResponse(response, reload), total };
}

export async function download({ url, params }, filename) {
	const res = await fetch(buildUrl({ url, params }));
	if (!res.ok) await processResponse(res);
	const bl = await res.blob();
	const u = window.URL.createObjectURL(bl);
	const a = document.createElement("a");
	a.href = u;
	a.download = filename;
	a.click();
	window.URL.revokeObjectURL(u);
}

export async function post({ url, params, data }, abortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "POST";

	let headers = {};

	let body;
	// Check if the data is an instance of FormData
	// If data is FormData, let the browser set the Content-Type header
	if (data instanceof FormData) {
		if ((await new Response(data).blob()).size > 1024 * 1024) throw new Error("error.max-upload-size");
		body = data;
	} else {
		// If data is JSON, set the Content-Type header to 'application/json'
		headers = {
			[contentTypeHeader]: "application/json",
		};
		body = buildBody(data, url);
	}

	const signal = abortController?.signal;
	const response = await fetch(apiUrl, { method, headers, body, signal });
	return processResponse(response);
}

export async function put({ url, params, data }, abortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "PUT";
	const headers = {
		[contentTypeHeader]: "application/json",
	};
	const signal = abortController?.signal;
	const body = buildBody(data, url);
	const response = await fetch(apiUrl, { method, headers, body, signal });
	return processResponse(response);
}

export async function del({ url, params }, abortController) {
	const apiUrl = buildUrl({ url, params });
	const method = "DELETE";
	const signal = abortController?.signal;
	const response = await fetch(apiUrl, { method, signal });
	return processResponse(response);
}
