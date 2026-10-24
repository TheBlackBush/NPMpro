// included by nginx.conf: the error log at main level, the stream access log in stream {}
const ERROR_LOG_CONF = "/data/npmpro/nginx/error-log.conf";
const STREAM_LOG_CONF = "/data/npmpro/nginx/stream-log.conf";
// the live logrotate config: start.sh copies /etc/logrotate there at every start (PUID can not write /etc)
const LOGROTATE_CONF = "/run/npmpro/logrotate";

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

/**
 * The logrotate config with every `rotate N` set to the number of rotations (start.sh does the same with sed)
 *
 * @param   {string}  content
 * @param   {number}  rotations
 * @returns {string}
 */
const renderRotations = (content, rotations) =>
	content.replaceAll(/^(?<head>\s*rotate\s+)\d+/gmu, `$<head>${rotations}`);

export { ERROR_LOG_CONF, LOGROTATE_CONF, logIncludes, renderRotations, STREAM_LOG_CONF };
