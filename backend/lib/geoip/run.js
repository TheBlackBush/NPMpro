import { fetch as undiciFetch } from "undici";
import { guardedAgent } from "../outbound-guard.js";
import { updateDbip } from "./dbip.js";
import { selectedEditions } from "./providers.js";
import { updateGeoip } from "./update.js";

let inFlight = null;
let queued = null;

// the guarded agent is the only one production uses; test code may swap it (setGeoipAgent), like the webhook channel's
let agent = guardedAgent;

/**
 * Test seam: the dispatcher of the GeoIP downloads (undefined: the global dispatcher, an undici MockAgent in tests)
 *
 * @param {Object|undefined}  next
 */
const setGeoipAgent = (next) => {
	agent = next;
};

/**
 * A fetch whose every connection, also after a redirect, goes through the dispatcher given by getAgent (by default the
 * agent of this module, the outbound guard).
 *
 * @param   {Object}    [seams]
 * @param   {Function}  [seams.fetchFn]   undici's fetch
 * @param   {Function}  [seams.getAgent]  () => the dispatcher
 * @returns {Function}
 */
const createGuardedFetch =
	({ fetchFn = undiciFetch, getAgent = () => agent } = {}) =>
	(url, init = {}) => {
		const dispatcher = getAgent();
		return fetchFn(url, dispatcher ? { ...init, dispatcher } : init);
	};

const guardedFetch = createGuardedFetch();

/**
 * Updates the databases of the active provider, records the outcome and reloads the readers when any file was replaced
 * (`ok` means every requested edition succeeded, `updated` can be non-empty without it). Runs of either provider never
 * overlap: a call while a run is in progress queues one follow-up run (shared by all such calls) that reads the
 * configuration when it starts, so newly saved credentials and a switched provider are always used.
 *
 * @param   {Object}    options
 * @param   {Object}    options.geoip           createGeoip() instance
 * @param   {string}    options.dir
 * @param   {Function}  options.recordResult    ({ ok, error, updated, provider }) => Promise
 * @param   {Function}  options.getConfig
 * @param   {Object}    [options.updaters]      { maxmind, dbip }, each gets the guarded fetch
 * @param   {Function}  [options.fetch]         the fetch handed to the updaters
 * @returns {Promise<{ok: boolean, updated: string[], error?: string, provider: string}>}
 */
const runConfiguredGeoipUpdate = (options) => {
	if (!inFlight) {
		inFlight = runOnce(options).finally(() => {
			inFlight = null;
		});
		return inFlight;
	}
	if (!queued) {
		queued = inFlight
			.catch(() => {})
			.then(() => {
				queued = null;
				return runConfiguredGeoipUpdate(options);
			});
	}
	return queued;
};

/**
 * Resolves when no update is running or queued (a database move waits for the result to be recorded); a failed run
 * counts as done.
 *
 * @returns {Promise<void>}
 */
const geoipUpdateSettled = async () => {
	while (inFlight || queued) await (queued ?? inFlight).catch(() => {});
};

const runOnce = async ({
	geoip,
	dir,
	recordResult,
	getConfig,
	updaters = { maxmind: updateGeoip, dbip: updateDbip },
	fetch = guardedFetch,
}) => {
	const { values } = await getConfig();
	const provider = values.provider === "maxmind" ? "maxmind" : "dbip";
	if (provider === "maxmind" && (!values.account_id || !values.license_key)) {
		return { ok: false, updated: [], error: "MaxMind account ID and license key are required", provider };
	}
	const editions = selectedEditions(values);
	// no databases selected: nothing to download, the files already downloaded stay
	if (editions.length === 0) return { ok: true, updated: [], provider };
	const result = await updaters[provider](
		provider === "maxmind"
			? { accountId: values.account_id, licenseKey: values.license_key, editions, dir, fetch }
			: { editions, dir, fetch },
	);
	try {
		await recordResult({ ...result, provider });
	} finally {
		if (result.updated.length > 0) await geoip.reload();
	}
	return { ...result, provider };
};

export { createGuardedFetch, geoipUpdateSettled, guardedFetch, runConfiguredGeoipUpdate, setGeoipAgent };
