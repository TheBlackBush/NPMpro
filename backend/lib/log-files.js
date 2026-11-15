import nodeFs from "node:fs/promises";
import path from "node:path";
import { global as logger } from "../logger.js";
import { rooted } from "./paths.js";
import { ACCESS_LOG_CONF, accessLogDirective } from "./traffic/access-log.js";

// included by nginx.conf: the error log at main level, the stream access log in stream {}
const ERROR_LOG_CONF = rooted("/data/npmpro/nginx/error-log.conf");
const STREAM_LOG_CONF = rooted("/data/npmpro/nginx/stream-log.conf");
// included by the default servers (default.conf, conf.d/npmpro.conf): their own error logs, with tls.log at info
const TLS_LOG_CONF = rooted("/data/npmpro/nginx/tls-log.conf");
const TLS_LOG_FILE = "tls.log";
// the main error log lines of nginx.conf and error-log.conf: a server-level error_log replaces the inherited ones
const TLS_LOG_ON =
	"error_log stderr warn;\nerror_log /data/nginx/logs/error.log warn;\nerror_log /data/nginx/logs/tls.log info;\n";
const TLS_LOG_OFF = "# no TLS handshake log (Settings, Logs & monitoring)\n";
// the live logrotate config: start.sh copies /etc/logrotate there at every start (PUID can not write /etc)
const LOGROTATE_CONF = rooted("/run/npmpro/logrotate");

/**
 * The error log and stream log includes for Write log files (start.sh writes the same lines at boot from LOGROTATE);
 * off: no error log file (nginx.conf logs errors to stderr) and no stream access log; format (classic or json) picks
 * the stream log format (slog or sjson)
 *
 * @param   {boolean}  writeLogFiles
 * @param   {string}   [format]
 * @param   {boolean}  [tlsHandshakeLog]  on only with the log files on
 * @returns {{error: string, stream: string, tls: string}}
 */
const logIncludes = (writeLogFiles, format = "classic", tlsHandshakeLog = false) => ({
	...(writeLogFiles
		? {
				error: "error_log /data/nginx/logs/error.log warn;\n",
				stream: `access_log /data/nginx/logs/stream.log ${format === "json" ? "sjson" : "slog"};\n`,
			}
		: { error: "# no error log file, errors go to stderr\n", stream: "access_log off;\n" }),
	tls: writeLogFiles && tlsHandshakeLog ? TLS_LOG_ON : TLS_LOG_OFF,
});

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
 * @param   {string[]}  [options.names]  the files under logs/ to create
 * @param   {boolean}  [options.links]  false: no /data/nginx/<name> symlinks (tls.log never existed at the old place)
 * @returns {Promise<void>}
 */
const prepareLogFiles = async ({ nginxDir, fs = nodeFs, log = logger, names = LOG_FILES, links = true }) => {
	const logsDir = path.join(nginxDir, "logs");
	for (const name of names) {
		const file = path.join(logsDir, name);
		try {
			await fs.writeFile(file, "", { flag: "wx", mode: 0o600 });
		} catch (err) {
			if (err.code !== "EEXIST") log.warn(`Could not create ${file}: ${err.message}`);
		}
		if (!links) continue;
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
 * The four includes with Write log files on (error, stream, access and TLS handshake log), as withFiles entries
 *
 * @param   {string}   [format]           the log format setting (classic or json)
 * @param   {boolean}  [tlsHandshakeLog]  the TLS handshake log setting
 * @returns {{path: string, content: string, nginx: true}[]}
 */
const logFilesOn = (format = "classic", tlsHandshakeLog = false) => {
	const includes = logIncludes(true, format, tlsHandshakeLog);
	return [
		{ path: ERROR_LOG_CONF, content: includes.error, nginx: true },
		{ path: STREAM_LOG_CONF, content: includes.stream, nginx: true },
		{ path: ACCESS_LOG_CONF, content: accessLogDirective(true, format), nginx: true },
		{ path: TLS_LOG_CONF, content: includes.tls, nginx: true },
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

export {
	ERROR_LOG_CONF,
	LOGROTATE_CONF,
	logFilesOn,
	logIncludes,
	prepareLogFiles,
	renderRotations,
	STREAM_LOG_CONF,
	TLS_LOG_CONF,
	TLS_LOG_FILE,
};
