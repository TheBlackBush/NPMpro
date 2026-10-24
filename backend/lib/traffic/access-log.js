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

export { ACCESS_LOG_CONF, accessLogDirective, applyAccessLog };
