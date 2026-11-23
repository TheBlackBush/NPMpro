const MIN_SECRET_LENGTH = 4;
const MAX_MESSAGE_LENGTH = 300;

/**
 * Makes provider text safe to store or show: every secret of at least 4 characters, and its URL-encoded form, becomes
 * ***; line breaks become spaces; the result is cut to 300 characters
 *
 * @param   {*}         text
 * @param   {String[]}  [secrets]
 * @returns {String}
 */
const scrubSecrets = (text, secrets = []) => {
	let out = String(text ?? "");
	const forms = secrets
		.filter((secret) => typeof secret === "string" && secret.length >= MIN_SECRET_LENGTH)
		.flatMap((secret) => [secret, encodeURIComponent(secret)])
		.sort((a, b) => b.length - a.length);
	for (const form of new Set(forms)) out = out.split(form).join("***");
	return out.replace(/[\r\n]+/gu, " ").slice(0, MAX_MESSAGE_LENGTH);
};

/** A failed provider call; its message is already scrubbed and may be shown */
class DdnsProviderError extends Error {
	name = "DdnsProviderError";
	public = true;

	constructor({ status = 0, code, message, retry = true, secrets = [] }) {
		super(scrubSecrets(message, secrets));
		this.status = status;
		this.code = code;
		this.retry = retry;
	}
}

export { DdnsProviderError, scrubSecrets };
