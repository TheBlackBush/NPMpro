import { global as logger } from "../../logger.js";
import { selectedEditions } from "./providers.js";

const RELOAD_MS = 10 * 60000;
const CHECK_MS = 3600000;
const REFRESH_MS = 3 * 24 * 3600000;
// DB-IP publishes monthly: a weekly check finds the new file within days (a HEAD request when nothing changed)
const DBIP_REFRESH_MS = 7 * 24 * 3600000;
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
 * Keeps the shared GeoIP readers current: reload() every 10 minutes (it only reopens changed files) and an automatic
 * update, checked a minute after start and then hourly; after each hourly check onTick runs (the geoip.conf sync). MaxMind: credentials exist and the last update is missing or
 * older than 3 days. DB-IP: a selected file is missing, the last check is missing or older than 7 days, or the last
 * check failed and is older than 24 hours. The update records its own result (lib/geoip/run.js).
 *
 * @param   {Object}    deps
 * @param   {Object}    deps.geoip      createGeoip() instance
 * @param   {Function}  deps.runUpdate  () => Promise<{ ok, updated, error }>
 * @param   {Function}  deps.getConfig  () => Promise<{ values }>, the effective GeoIP settings (getGeoipConfig)
 * @param   {Function}  [deps.filesPresent]  (values) => Promise<boolean>, every selected file of the active provider exists
 * @param   {Function}  [deps.onTick]  () => Promise, after the hourly check (not while paused); a failure is logged
 * @param   {Function}  [deps.now]
 * @param   {Object}    [deps.timers]
 * @returns {Object}
 */
const createGeoipService = ({
	geoip,
	runUpdate,
	getConfig,
	filesPresent = () => Promise.resolve(true),
	onTick = () => Promise.resolve(),
	now = Date.now,
	timers = defaultTimers,
	log = logger,
}) => {
	let reloadTimer = null;
	let checkTimer = null;
	let firstTimer = null;
	// per provider: a switch is not held back by the other provider's attempt
	const lastAttempt = new Map();
	// a database move: the checks do not start an update (the reload timer goes on, it only reopens files)
	let paused = false;

	const reload = () =>
		geoip.reload().catch((err) => log.error(`GeoIP: could not reload the databases: ${err.message}`));

	const olderThan = (stamp, ms) => {
		const at = stamp ? Date.parse(stamp) : Number.NaN;
		return !Number.isFinite(at) || now() - at >= ms;
	};

	/** @returns {Promise<boolean>}  the active provider's schedule asks for an update */
	const isDue = async (values) => {
		if (values.provider === "maxmind") {
			if (!values.account_id || !values.license_key) return false;
			return olderThan(values.last_update, REFRESH_MS);
		}
		if (selectedEditions(values).length === 0) return false;
		if (!(await filesPresent(values))) return true;
		// every recorded run moves last_check: a failed check is due again after the retry wait, not after a week
		if (values.last_error) return olderThan(values.last_check, RETRY_MS);
		return olderThan(values.last_check, DBIP_REFRESH_MS);
	};

	/** Runs the update when it is due; resolves to the update result or null when nothing ran. */
	const check = async () => {
		try {
			if (paused) return null;
			const { values } = await getConfig();
			if (!(await isDue(values))) return null;
			const attempted = lastAttempt.get(values.provider);
			if (attempted !== undefined && now() - attempted < RETRY_MS) return null;
			// paused while the settings were read: runUpdate() marks the run as going on at once, so a pause sees it
			if (paused) return null;
			lastAttempt.set(values.provider, now());
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
			const hourly = async () => {
				await check();
				if (!paused) await onTick();
			};
			reloadTimer = timers.setInterval(() => {
				reload().catch(onError);
			}, RELOAD_MS);
			checkTimer = timers.setInterval(() => {
				hourly().catch(onError);
			}, CHECK_MS);
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
