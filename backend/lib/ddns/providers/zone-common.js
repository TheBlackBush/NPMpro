import { normalizeDomainName } from "../../dns-domain-name.js";
import { DdnsProviderError } from "../errors.js";

const MAX_ZONES = 1000;
// 1000 zones at the smallest page size of the providers is 20 pages of 50; 25 leaves room for short pages
const MAX_PAGES = 25;

/**
 * The message of a failed provider answer: errors[0].message, message, or the first 300 characters of the text.
 *
 * @param   {{ json: *, text: string }} res
 * @returns {String}
 */
const providerMessage = (res) => {
	const body = res.json;
	const text = body?.errors?.[0]?.message ?? body?.message ?? res.text;
	return typeof text === "string" && text !== "" ? text : "no message";
};

/**
 * Throws the error of an answer that is not the documented success: forbidden (with the hint) for 401, 403 and
 * a refused body, failed for anything else.
 *
 * @param {{ status: number, json: *, text: string }} res
 * @param {{ hint: string, secrets: String[], refused?: boolean }} options
 */
const failAnswer = (res, { hint, secrets, refused = false }) => {
	const forbidden = refused || res.status === 401 || res.status === 403;
	const err = new DdnsProviderError({
		status: res.status,
		code: forbidden ? "forbidden" : "failed",
		message: `${forbidden ? "Access refused" : "Unexpected answer"} (${res.status}): ${providerMessage(res)}`,
		retry: !forbidden,
		secrets,
	});
	if (forbidden) err.hint = hint;
	throw err;
};

/**
 * Fetches pages until `next` says there are no more (or 1000 names are in), and returns the cleaned zone list.
 *
 * @param   {Object}   options
 * @param   {Function} options.fetchPage  (page) => Promise<{ names: unknown[], more: boolean }>
 * @returns {Promise<String[]>}
 */
const collectZones = async ({ fetchPage }) => {
	const found = new Set();
	let truncated = false;
	let previous = null;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { names, more } = await fetchPage(page);
		const key = JSON.stringify(names);
		const repeated = key === previous;
		previous = key;
		for (const raw of names) {
			const result = normalizeDomainName(raw);
			if (result.name) found.add(result.name);
		}
		if (found.size > MAX_ZONES || (more && repeated)) {
			truncated = true;
			break;
		}
		if (!more) break;
		// the cap stops paging while the provider still has more
		if (page === MAX_PAGES) truncated = true;
	}
	const sorted = [...found].sort((a, b) => a.localeCompare(b));
	const zones = sorted.slice(0, MAX_ZONES);
	if (truncated || sorted.length > MAX_ZONES) zones.truncated = true;
	return zones;
};

const malformed = (res, secrets) =>
	new DdnsProviderError({ status: res.status, code: "failed", message: "Unexpected answer shape", secrets });

const bearer = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });

export { bearer, collectZones, failAnswer, malformed };
