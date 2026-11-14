import nodeFs from "node:fs/promises";
import path from "node:path";
import { global as logger } from "../logger.js";
import { rooted } from "./paths.js";
import { ACCESS_LOG_CONF, accessLogDirective } from "./traffic/access-log.js";

// included by nginx.conf: the error log at main level, the stream access log in stream {}
const ERROR_LOG_CONF = rooted("/data/npmpro/nginx/error-log.conf");
const STREAM_LOG_CONF = rooted("/data/npmpro/nginx/stream-log.conf");
// the live logrotate config: start.sh copies /etc/logrotate there at every start (PUID can not write /etc)
const LOGROTATE_CONF = rooted("/run/npmpro/logrotate");

/**
 * The error log and stream log includes for Write log files (start.sh writes the same lines at boot from LOGROTATE);
 * off: no error log file (nginx.conf logs errors to stderr) and no stream access log
 *
 * @param   {boolean}  writeLogFiles
 * @returns {{error: string, stream: string}}
 */
const logIncludes = (writeLogFiles) =>
	writeLogFiles
		? {
				error: "error_log /data/nginx/logs/error.log warn;\n",
				stream: "access_log /data/nginx/logs/stream.log slog;\n",
			}
		: { error: "# no error log file, errors go to stderr\n", stream: "access_log off;\n" };

// the log files Write log files turns on, created like start.sh does (mode 0600, /data/nginx/<name> symlinks)
const LOG_FILES = ["access.log", "error.log", "stream.log"];

/**
 * Creates the missing log files (mode 0600, existing ones are kept as they are) and the missing compatibility
 * symlinks /data/nginx/<name> -> logs/<name>, like start.sh with LOGROTATE=true; failures are logged, nginx still
 * opens (and creates) the files itself
 *
 * @param   {Object}  options
 * @param   {string}  options.nginxDir  /data/nginx
 * @param   {Object}  [options.fs]
 * @param   {Object}  [options.log]
 * @returns {Promise<void>}
 */
const prepareLogFiles = async ({ nginxDir, fs = nodeFs, log = logger }) => {
	const logsDir = path.join(nginxDir, "logs");
	for (const name of LOG_FILES) {
		const file = path.join(logsDir, name);
		try {
			await fs.writeFile(file, "", { flag: "wx", mode: 0o600 });
		} catch (err) {
			if (err.code !== "EEXIST") log.warn(`Could not create ${file}: ${err.message}`);
		}
		const link = path.join(nginxDir, name);
		try {
			await fs.lstat(link);
		} catch (err) {
			if (err.code !== "ENOENT") {
				log.warn(`Could not check ${link}: ${err.message}`);
				continue;
			}
			try {
				await fs.symlink(path.join("logs", name), link);
			} catch (linkErr) {
				log.warn(`Could not create the symlink ${link}: ${linkErr.message}`);
			}
		}
	}
};

/**
 * The three includes with Write log files on (error, stream and access log), as withFiles entries
 *
 * @returns {{path: string, content: string, nginx: true}[]}
 */
const logFilesOn = () => {
	const includes = logIncludes(true);
	return [
		{ path: ERROR_LOG_CONF, content: includes.error, nginx: true },
		{ path: STREAM_LOG_CONF, content: includes.stream, nginx: true },
		{ path: ACCESS_LOG_CONF, content: accessLogDirective(true), nginx: true },
	];
};

/**
 * The logrotate config with every `rotate N` set to the number of rotations (start.sh does the same with sed)
 *
 * @param   {string}  content
 * @param   {number}  rotations
 * @returns {string}
 */
const renderRotations = (content, rotations) =>
	content.replaceAll(/^(?<head>[ \t]*rotate[ \t]+)\d+/gmu, `$<head>${rotations}`);

export { ERROR_LOG_CONF, LOGROTATE_CONF, logFilesOn, logIncludes, prepareLogFiles, renderRotations, STREAM_LOG_CONF };
