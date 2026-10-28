import { global as logger } from "../../logger.js";

const RELOAD_MS = 10 * 60000;
const CHECK_MS = 3600000;
const REFRESH_MS = 3 * 24 * 3600000;
// a failed automatic update is tried again after this long, not on every check (MaxMind limits downloads)
const RETRY_MS = 24 * 3600000;
const FIRST_CHECK_MS = 60000;

const defaultTimers = {
	setInterval: (fn, ms) => setInterval(fn, ms),
	clearInterval: (t) => clearInterval(t),
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (t) => clearTimeout(t),
};

/**
 * Keeps the shared GeoIP readers current: reload() every 10 minutes (it only reopens changed files) and an
 * automatic database update when credentials exist and the last update is missing or older than 3 days,
 * checked a minute after start and then hourly. The update records its own result (lib/geoip/run.js).
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.geoip      createGeoip() instance
 * @param   {Function}  deps.runUpdate  () => Promise<{ ok, updated, error }>
 * @param   {Function}  deps.getConfig  () => Promise<{ values: { account_id, license_key, last_update } }>
 * @param   {Function}  [deps.now]
 * @param   {Object}    [deps.timers]
 * @returns {Object}
 */
const createGeoipService = ({ geoip, runUpdate, getConfig, now = Date.now, timers = defaultTimers, log = logger }) => {
	let reloadTimer = null;
	let checkTimer = null;
	let firstTimer = null;
	let lastAttempt = null;
	// a database move: the checks do not start an update (the reload timer goes on, it only reopens files)
	let paused = false;

	const reload = () =>
		geoip.reload().catch((err) => log.error(`GeoIP: could not reload the databases: ${err.message}`));

	/** Runs the update when it is due; resolves to the update result or null when nothing ran. */
	const check = async () => {
		try {
			if (paused) return null;
			const { values } = await getConfig();
			if (!values.account_id || !values.license_key) return null;
			const last = values.last_update ? Date.parse(values.last_update) : Number.NaN;
			if (Number.isFinite(last) && now() - last < REFRESH_MS) return null;
			if (lastAttempt !== null && now() - lastAttempt < RETRY_MS) return null;
			// paused while the settings were read: runUpdate() marks the run as going on at once, so a pause sees it
			if (paused) return null;
			lastAttempt = now();
			const result = await runUpdate();
			if (!result.ok) log.warn(`GeoIP: automatic update failed: ${result.error}`);
			return result;
		} catch (err) {
			log.error(`GeoIP: automatic update failed: ${err.message}`);
			return null;
		}
	};

	return {
		start: () => {
			if (reloadTimer) return;
			const onError = (err) => log.error(`GeoIP: ${err?.message ?? err}`);
			const runCheck = () => {
				check().catch(onError);
			};
			reloadTimer = timers.setInterval(() => {
				reload().catch(onError);
			}, RELOAD_MS);
			checkTimer = timers.setInterval(runCheck, CHECK_MS);
			firstTimer = timers.setTimeout(runCheck, FIRST_CHECK_MS);
			for (const t of [reloadTimer, checkTimer, firstTimer]) t?.unref?.();
		},
		stop: () => {
			if (reloadTimer) timers.clearInterval(reloadTimer);
			if (checkTimer) timers.clearInterval(checkTimer);
			if (firstTimer) timers.clearTimeout(firstTimer);
			reloadTimer = null;
			checkTimer = null;
			firstTimer = null;
		},
		/** The checks skip until resume(); the timers keep running, so resume() restores the state before. */
		pause: () => {
			paused = true;
		},
		resume: () => {
			paused = false;
		},
		check,
		reload,
	};
};

export { createGeoipService };
