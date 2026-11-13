import nodeFs from "node:fs/promises";
import { rooted } from "../paths.js";
import { withFiles } from "../runtime-apply.js";
import { CROWDSEC_CONF_PATH } from "./config.js";
import { renderCrowdsecConf } from "./settings.js";

// What Settings, CrowdSec writes: crowdsec.conf for the bouncer, and two includes nginx.conf and conf.d/npmpro.conf
// always read. rootfs/usr/local/bin/data-setup.sh writes the same include lines before the first start
// (test/crowdsec-files.test.js keeps them equal).
const BOUNCER_INCLUDE = rooted("/data/npmpro/nginx/crowdsec.conf");
const ADMIN_INCLUDE = rooted("/data/npmpro/nginx/crowdsec-admin.conf");
const INCLUDE_ON = "include /usr/local/nginx/conf/crowdsec-bouncer.conf;\n";
const INCLUDE_OFF = "# the CrowdSec bouncer is off (Settings, CrowdSec)\n";
const ADMIN_EXCLUDED = "set $npmpro_crowdsec_skip 1;\n";
const ADMIN_CHECKED = "# the admin UI is checked by CrowdSec (Settings, CrowdSec)\n";

/**
 * @param   {Object} values  effective values, secrets in plain text
 * @param   {Object} [options]
 * @param   {boolean} [options.bouncerOff]  write the include that leaves the bouncer off, whatever the values say
 * @returns {{ path: string, content: string }[]}
 */
const crowdsecFiles = (values, { bouncerOff = false } = {}) => [
	{ path: CROWDSEC_CONF_PATH, content: renderCrowdsecConf(values) },
	{ path: BOUNCER_INCLUDE, content: values.enabled && !bouncerOff ? INCLUDE_ON : INCLUDE_OFF },
	{ path: ADMIN_INCLUDE, content: values.admin_ui_excluded ? ADMIN_EXCLUDED : ADMIN_CHECKED },
];

// crowdsec.conf holds the API key: 0600 before the write (withFiles keeps the mode of the file it replaces)
const ensurePrivate = async (fs, file) => {
	try {
		await fs.chmod(file, 0o600);
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
		await fs.writeFile(file, "", { mode: 0o600, flag: "wx" }).catch((error) => {
			if (error.code !== "EEXIST") throw error;
		});
	}
};

/**
 * Writes the three files, runs fn (nginx -t, the save, the reload) and puts the previous files back when fn throws
 *
 * @param   {Object}   values
 * @param   {Function} [fn]       (writtenPaths) => result
 * @param   {Object}   [deps]
 * @param   {Object}   [deps.fs]
 * @param   {Object}   [deps.log]
 * @param   {boolean}  [deps.bouncerOff]  see crowdsecFiles
 * @returns {Promise<*>} the result of fn
 */
const applyCrowdsecFiles = async (values, fn, { fs = nodeFs, log, bouncerOff = false } = {}) => {
	await ensurePrivate(fs, CROWDSEC_CONF_PATH);
	return await withFiles(crowdsecFiles(values, { bouncerOff }), fn, { fs, log });
};

/**
 * @param   {Object} [deps]
 * @returns {Promise<boolean>} whether nginx.conf's include turns the bouncer on
 */
const bouncerLoaded = async ({ fs = nodeFs } = {}) =>
	(await fs.readFile(BOUNCER_INCLUDE, "utf8").catch(() => "")) === INCLUDE_ON;

export {
	ADMIN_CHECKED,
	ADMIN_EXCLUDED,
	ADMIN_INCLUDE,
	applyCrowdsecFiles,
	BOUNCER_INCLUDE,
	bouncerLoaded,
	crowdsecFiles,
	INCLUDE_OFF,
	INCLUDE_ON,
};
