import { readFile, rm, writeFile } from "node:fs/promises";
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
 * Writes the access_log include, then tests and reloads nginx. When the test or the reload fails,
 * the previous content is restored and a ValidationError with the nginx output is thrown; reload
 * only runs after a passing test. Nothing is tested or reloaded when the file already has the content.
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

	await writeFile(file, next, { mode: 0o600 });
	if (writeOnly) return true;

	try {
		await test();
		await reload();
	} catch (err) {
		// Keep the file in line with the saved setting, so a later reload does not switch logging
		if (previous === null) {
			await rm(file, { force: true });
		} else {
			await writeFile(file, previous, { mode: 0o600 });
		}
		throw new errs.ValidationError(err.message || "nginx config test failed", undefined, { cause: err });
	}
	return true;
};

export { ACCESS_LOG_CONF, accessLogDirective, applyAccessLog };
