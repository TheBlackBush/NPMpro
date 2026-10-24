import nodeFs from "node:fs/promises";
import path from "node:path";
import { global as logger } from "../logger.js";
import { hasStaplingFile, staplingFileOf, TLS_DIR } from "./default-cert.js";
import utils from "./utils.js";

const MIN_INTERVAL = 10 * 60 * 1000;
const OCSP_DIRS = { acme: `${TLS_DIR}/certbot/live`, custom: `${TLS_DIR}/custom` };
const TIMEOUT_SECONDS = 60;
// timeout(1) exit status when it stopped the command
const TIMED_OUT = 124;

/**
 * The command for a fetcher run: GNU timeout (coreutils) runs it in its own process group and signals the whole
 * group, so children (openssl, curl) do not outlive a timeout; SIGKILL follows after killAfter seconds
 *
 * @param   {string}    cmd
 * @param   {string[]}  args
 * @param   {Object}    [options]
 * @param   {number}    [options.seconds]
 * @param   {number}    [options.killAfter]
 * @returns {{cmd: string, args: string[], timeout: number}}  timeout: the node backstop in ms
 */
const boundedCommand = (cmd, args, { seconds = TIMEOUT_SECONDS, killAfter = 5 } = {}) => ({
	cmd: "timeout",
	args: ["-k", String(killAfter), String(seconds), cmd, ...args],
	timeout: (seconds + killAfter + 5) * 1000,
});

/**
 * Runs certbot-ocsp-fetcher.sh for the certbot ("acme") or custom certificates
 *
 * @param   {"acme"|"custom"}  kind
 * @returns {Promise<string>}
 */
const runOcspFetcher = (kind) => {
	const dir = OCSP_DIRS[kind];
	const command = boundedCommand("certbot-ocsp-fetcher.sh", [
		"-c",
		dir,
		"-o",
		dir,
		"--no-reload-webserver",
		"--quiet",
	]);
	return utils.execFile(command.cmd, command.args, { timeout: command.timeout });
};

/**
 * The names of the OCSP responses (.der files that are not empty) of the certbot ("acme") or custom certificates
 *
 * @param   {"acme"|"custom"}  kind
 * @param   {Object}  [options]
 * @param   {Object}  [options.fs]
 * @param   {Object}  [options.dirs]
 * @returns {Promise<Set<string>>}
 */
const listResponses = async (kind, { fs = nodeFs, dirs = OCSP_DIRS } = {}) => {
	const names = new Set();
	let entries;
	try {
		entries = await fs.readdir(dirs[kind]);
	} catch {
		return names;
	}
	for (const name of entries) {
		if (!name.endsWith(".der")) continue;
		try {
			if ((await fs.stat(path.join(dirs[kind], name))).size > 0) names.add(name);
		} catch {}
	}
	return names;
};

/**
 * Bounds the OCSP fetcher per kind: a call while one runs shares it, a call within minInterval of the last attempt
 * is skipped. Certificates without an OCSP responder (Let's Encrypt since 2025) never get a .der file, so without
 * the bound every host render and reload would run a full fetch. force (stapling switched on) skips the interval;
 * while a run is in flight it waits for it and starts a new one. A failed or timed out run is logged with its kind.
 * With listResponses, a run (also a failed one) that brought new .der files calls the onNewResponses listener with
 * the kind and their names; the listener is not awaited, so it may queue work behind the caller of the fetch.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.run            (kind) => Promise, runs the fetcher
 * @param   {Function}  [deps.listResponses] (kind) => Promise<Set<string>>, the .der files there are
 * @param   {Function}  [deps.now]          () => ms
 * @param   {number}    [deps.minInterval]  ms between two attempts of the same kind
 * @param   {Object}    [deps.log]          logger with warn()
 * @returns {Function}  (kind, { force }) => Promise<void>, with onNewResponses(fn) to set the listener
 */
const createOcspFetcher = ({ run, listResponses: list, now = Date.now, minInterval = MIN_INTERVAL, log = logger }) => {
	const attempts = new Map();
	let listener = null;

	const snapshot = (kind) => (list && listener ? list(kind).catch(() => null) : Promise.resolve(null));

	const announce = async (kind, before) => {
		if (before === null || !listener) return;
		const after = await list(kind).catch(() => null);
		const added = after === null ? [] : [...after].filter((name) => !before.has(name));
		if (added.length === 0) return;
		try {
			// not awaited: the listener queues work that may wait for whoever waits for this fetch
			Promise.resolve(listener(kind, added)).catch((err) =>
				log.warn(`OCSP response listener failed: ${err.message}`),
			);
		} catch (err) {
			log.warn(`OCSP response listener failed: ${err.message}`);
		}
	};

	const start = (kind, after = Promise.resolve()) => {
		const attempt = { at: now(), running: true };
		attempt.promise = after
			.then(async () => {
				attempt.at = now();
				const before = await snapshot(kind);
				try {
					return await run(kind);
				} finally {
					await announce(kind, before);
				}
			})
			.then(
				() => {},
				(err) => {
					const code = err?.cause?.code;
					const reason =
						code === TIMED_OUT || err?.cause?.killed ? "timed out" : `failed (exit ${code ?? "unknown"})`;
					log.warn(`OCSP response fetch for the ${kind} certificates ${reason}`);
				},
			)
			.finally(() => {
				attempt.running = false;
			});
		attempts.set(kind, attempt);
		return attempt.promise;
	};

	const fetcher = (kind, { force = false } = {}) => {
		const last = attempts.get(kind);
		if (!last) return start(kind);
		if (force) return start(kind, last.running ? last.promise : undefined);
		if (last.running || now() - last.at < minInterval) return last.promise;
		return start(kind);
	};
	/**
	 * @param {Function|null} fn  (kind, names) => void, called after a run that brought new .der files
	 */
	fetcher.onNewResponses = (fn) => {
		listener = typeof fn === "function" ? fn : null;
	};
	return fetcher;
};

const fetchOcsp = createOcspFetcher({ run: runOcspFetcher, listResponses: (kind) => listResponses(kind) });

/**
 * Whether the host can staple (its .der file exists). With stapling on for its kind and no file yet (a new
 * certificate), fetches first unless fetchMissingOcsp is false (the caller fetched already).
 *
 * @param   {Object}    host      with certificate_id and the certificate relation
 * @param   {Object}    env       the env the templates read
 * @param   {Object}    [options]
 * @param   {boolean}   [options.fetchMissingOcsp]
 * @param   {Function}  [options.fetch]  (kind) => Promise
 * @param   {Object}    [options.fs]
 * @param   {string}    [options.tlsDir]
 * @returns {Promise<boolean>}
 */
const staplingFileReady = async (host, env, { fetchMissingOcsp = true, fetch = fetchOcsp, fs, tlsDir } = {}) => {
	const stapling = staplingFileOf(host, tlsDir);
	if (stapling === null) return false;
	if (await hasStaplingFile(host, { fs, tlsDir })) return true;
	if (!fetchMissingOcsp || env[stapling.env] !== "true") return false;
	await fetch(stapling.kind);
	return hasStaplingFile(host, { fs, tlsDir });
};

export {
	boundedCommand,
	createOcspFetcher,
	fetchOcsp,
	listResponses,
	MIN_INTERVAL,
	OCSP_DIRS,
	runOcspFetcher,
	staplingFileReady,
};
