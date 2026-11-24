const MIN_SECRET_LENGTH = 4;
const MAX_MESSAGE_LENGTH = 300;

/**
 * Makes provider text safe to store or show: every secret of at least 4 characters, and its URL-encoded forms (%20
 * and +) and its JSON-escaped form, becomes ***; line breaks become spaces; the result is cut to 300 characters
 *
 * @param   {*}         text
 * @param   {String[]}  [secrets]
 * @returns {String}
 */
const scrubSecrets = (text, secrets = []) => {
	let out = String(text ?? "");
	const forms = secrets
		.filter((secret) => typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH)
		.flatMap((secret) => [
			secret,
			encodeURIComponent(secret),
			encodeURIComponent(secret).replaceAll("%20", "+"),
			JSON.stringify(secret).slice(1, -1),
		])
		.sort((a, b) => b.length - a.length);
	for (const form of new Set(forms)) out = out.split(form).join("***");
	return out.replace(/[\r\n]+/gu, " ").slice(0, MAX_MESSAGE_LENGTH);
};

/**
 * A failed provider call; its message is already scrubbed and may be shown. The provider's HTTP status is
 * providerStatus, never status: the API error handler answers with err.status, and a provider's 401 or 403 must not
 * become the instance's own answer.
 */
class DdnsProviderError extends Error {
	name = "DdnsProviderError";
	public = true;

	constructor({ providerStatus = 0, code, message, retry = true, retryAfterMs, secrets = [] }) {
		super(scrubSecrets(message, secrets));
		this.providerStatus = providerStatus;
		this.code = code;
		this.retry = retry;
		// a provider that says how long to leave the record alone: the engine never tries sooner (a floor, not a stop)
		if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) this.retryAfterMs = retryAfterMs;
	}
}

export { DdnsProviderError, scrubSecrets };
