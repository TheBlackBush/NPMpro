const MIN_INTERVAL = 10 * 60 * 1000;

/**
 * Bounds the OCSP fetcher per kind: a call while one runs shares it, a call within minInterval of the last attempt
 * is skipped. Certificates without an OCSP responder (Let's Encrypt since 2025) never get a .der file, so without
 * the bound every host render and reload would run a full fetch.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.run            (kind) => Promise, runs the fetcher; a failure is ignored
 * @param   {Function}  [deps.now]          () => ms
 * @param   {number}    [deps.minInterval]  ms between two attempts of the same kind
 * @returns {(kind: string) => Promise<void>}
 */
const createOcspFetcher = ({ run, now = Date.now, minInterval = MIN_INTERVAL }) => {
	const attempts = new Map();
	return (kind) => {
		const last = attempts.get(kind);
		if (last && (last.running || now() - last.at < minInterval)) return last.promise;
		const attempt = { at: now(), running: true };
		attempt.promise = Promise.resolve()
			.then(() => run(kind))
			.catch(() => {})
			.finally(() => {
				attempt.running = false;
			});
		attempts.set(kind, attempt);
		return attempt.promise;
	};
};

export { createOcspFetcher, MIN_INTERVAL };
