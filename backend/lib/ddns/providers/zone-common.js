import { normalizeDomainName } from "../../dns-domain-name.js";
import { DdnsProviderError } from "../errors.js";

const MAX_ZONES = 1000;
// 1000 zones at the smallest page size of the providers is 20 pages of 50; 25 leaves room for short pages
const MAX_PAGES = 25;

const filled = (value) => typeof value === "string" && value !== "";

/**
 * The message of a failed provider answer, by the shapes of the providers: errors[].message or errors[].reason
 * (Cloudflare, Linode; several joined), message, Message (bunny.net), detail (deSEC), error (Vultr), else the text.
 * The caller scrubs the secrets from it.
 *
 * @param   {{ json: *, text: string }} res
 * @returns {String}
 */
const providerMessage = (res) => {
	const body = res.json;
	const listed = Array.isArray(body?.errors)
		? body.errors.map((item) => [item?.message, item?.reason].find(filled)).filter(filled)
		: [];
	if (listed.length > 0) return listed.join("; ");
	const text = [body?.message, body?.Message, body?.detail, body?.error, res.text].find(filled);
	return text ?? "no message";
};

/**
 * Throws the error of an answer that is not the documented success: forbidden (with the hint) for 401, 403 and
 * a refused body, failed for anything else.
 *
 * @param {{ status: number, json: *, text: string }} res
 * @param {{ hint: string, secrets: String[], refused?: boolean, refusedRetryAfterMs?: number }} options
 */
const failAnswer = (res, { hint, secrets, refused = false, refusedRetryAfterMs }) => {
	const forbidden = refused || res.status === 401 || res.status === 403;
	const err = new DdnsProviderError({
		providerStatus: res.status,
		code: forbidden ? "forbidden" : "failed",
		message: `${forbidden ? "Access refused" : "Unexpected answer"} (${res.status}): ${providerMessage(res)}`,
		retry: !forbidden,
		retryAfterMs: forbidden ? refusedRetryAfterMs : undefined,
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
 * @param   {number}   [options.maxPages]  at most this many page calls (default 25; the credential Test asks for 1)
 * @returns {Promise<String[]>}
 */
const collectZones = async ({ fetchPage, maxPages = MAX_PAGES }) => {
	const pageLimit = Math.min(Math.max(1, Math.trunc(maxPages) || MAX_PAGES), MAX_PAGES);
	const found = new Set();
	let truncated = false;
	let previous = null;
	for (let page = 1; page <= pageLimit; page++) {
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
		if (page === pageLimit) truncated = true;
	}
	const sorted = [...found].sort((a, b) => a.localeCompare(b));
	const zones = sorted.slice(0, MAX_ZONES);
	if (truncated || sorted.length > MAX_ZONES) zones.truncated = true;
	return zones;
};

const malformed = (res, secrets) =>
	new DdnsProviderError({ providerStatus: res.status, code: "failed", message: "Unexpected answer shape", secrets });

const bearer = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });

/**
 * The Test answer for a refused call, by the provider's HTTP status (Task 8a.1 mapping); a status not in the map,
 * or a provider that cannot tell the two apart, is "refused"
 *
 * @param   {Object<number, "wrong-key"|"missing-right">} map
 * @returns {(err: Error) => "wrong-key"|"missing-right"|"refused"}
 */
const statusRefusal = (map) => (err) => map[err?.providerStatus] ?? "refused";

export { bearer, collectZones, failAnswer, malformed, statusRefusal };
