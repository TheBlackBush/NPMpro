import { readFile, rename, writeFile } from "node:fs/promises";
import { global as logger } from "../../logger.js";
import errs from "../error.js";

const ACCESS_LOG_CONF = "/data/npmpro/nginx/access-log.conf";

/**
 * The http level access_log directive nginx includes from ACCESS_LOG_CONF
 *
 * @param   {boolean} enabled
 * @returns {string}
 */
const accessLogDirective = (enabled) =>
	enabled ? "access_log /data/nginx/logs/access.log alog;\n" : "access_log off;\n";

const readCurrent = async (file) => {
	try {
		return await readFile(file, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
};

/**
 * Replaces the file in one step (temp file + rename), so nginx never sees an empty or partial include
 *
 * @param {string} file
 * @param {string} content
 */
const writeAtomic = async (file, content) => {
	const tmp = `${file}.tmp`;
	await writeFile(tmp, content, { mode: 0o600 });
	await rename(tmp, file);
};

/**
 * Writes the access_log include, then tests and reloads nginx. When the write, the test or the
 * reload fails, the previous content is restored (the opposite directive when there was none, since
 * nginx.conf always includes the file) and a ValidationError with the original error is thrown;
 * reload only runs after a passing test. Nothing is tested or reloaded when the file already has the content.
 *
 * @param   {boolean}  enabled
 * @param   {Object}   options
 * @param   {string}   [options.file]
 * @param   {Function} [options.test]       nginx -t
 * @param   {Function} [options.reload]     nginx reload
 * @param   {boolean}  [options.writeOnly]  only write the file, the caller reloads nginx later
 * @returns {Promise<boolean>}  true when the file was changed
 */
const applyAccessLog = async (enabled, { file = ACCESS_LOG_CONF, test, reload, writeOnly = false } = {}) => {
	const next = accessLogDirective(enabled);
	const previous = await readCurrent(file);
	if (previous === next) return false;

	if (writeOnly) {
		await writeAtomic(file, next);
		return true;
	}

	try {
		await writeAtomic(file, next);
		await test();
		await reload();
	} catch (err) {
		// Keep the file in line with the saved setting, so a later reload does not switch logging
		try {
			await writeAtomic(file, previous || accessLogDirective(!enabled));
		} catch (restoreErr) {
			logger.error(`Could not restore ${file}: ${restoreErr.message}`);
		}
		throw new errs.ValidationError(err.message || "nginx config test failed", undefined, { cause: err });
	}
	return true;
};

/**
 * Whether nginx writes the http access log: traffic statistics read it, Write log files keeps it on disk
 *
 * @param   {boolean}  trafficEnabled  monitoring traffic_enabled
 * @param   {boolean}  writeLogFiles   runtime logs write_log_files
 * @returns {boolean}
 */
const accessLogEnabled = (trafficEnabled, writeLogFiles) => trafficEnabled === true || writeLogFiles === true;

/**
 * The access log switch shared by the traffic statistics hook and the logs runtime settings: both compute the include
 * from accessLogEnabled() with the other setting's current value.
 *
 * The traffic hook runs before the monitoring setting is stored, so the value it applied is remembered and used by
 * enabled() (a logs save right after it must not read the old stored value); the hook runs in the runtime settings
 * queue, so it never writes the include at the same time as a logs save.
 *
 * @param   {Object}    deps
 * @param   {Function}  deps.readTrafficEnabled  () => stored monitoring traffic_enabled
 * @param   {Function}  deps.readWriteLogFiles   () => effective logs write_log_files
 * @param   {Function}  deps.apply               (enabled) => Promise<boolean>, writes the include, tests and reloads
 *                                               nginx (true when the file changed)
 * @param   {Function}  [deps.exclusive]         (fn) => runs fn in the runtime settings queue
 * @param   {Object}    [deps.log]
 * @returns {{enabled: Function, onTrafficEnabledChange: Function}}
 */
const createAccessLogSwitch = ({
	readTrafficEnabled,
	readWriteLogFiles,
	apply,
	exclusive = (fn) => fn(),
	log = logger,
}) => {
	// the traffic_enabled value the hook applied last (undefined: none yet, the stored value counts)
	let applied;
	const trafficEnabled = async () => applied ?? (await readTrafficEnabled());

	return {
		/** For the logs settings: the access log state with these write_log_files and the current traffic setting */
		enabled: async (writeLogFiles) => accessLogEnabled(await trafficEnabled(), writeLogFiles),
		/**
		 * The traffic statistics hook: the include for the new traffic value and the current write_log_files, then
		 * after() (the traffic reader). The value is remembered only when every step passed; when after() throws, the
		 * include is switched back and the remembered value stays.
		 *
		 * @param {boolean}   enabled
		 * @param {Function}  [after]
		 */
		onTrafficEnabledChange: (enabled, after) =>
			exclusive(async () => {
				const writeLogFiles = await readWriteLogFiles();
				const before = accessLogEnabled(await trafficEnabled(), writeLogFiles);
				const changed = await apply(accessLogEnabled(enabled, writeLogFiles));
				try {
					await after?.();
				} catch (err) {
					if (changed) {
						try {
							await apply(before);
						} catch (revertErr) {
							log.error(`Could not switch the access log back: ${revertErr.message}`);
						}
					}
					throw err;
				}
				applied = enabled;
				return changed;
			}),
	};
};

export { ACCESS_LOG_CONF, accessLogDirective, accessLogEnabled, applyAccessLog, createAccessLogSwitch };
