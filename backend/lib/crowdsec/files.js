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
const ADMIN_CHECKED = "# the admin UI is checked by CrowdSec (Settings, CrowdSec)\n";
// the bouncer's own variable (lib/crowdsec.lua is_appsec_enabled): the ban check runs, AppSec does not
const ADMIN_BANS = "set $crowdsec_disable_appsec 1;\n";
const ADMIN_OUT = "set $npmpro_crowdsec_skip 1;\n";
const ADMIN_INCLUDES = { checked: ADMIN_CHECKED, bans: ADMIN_BANS, out: ADMIN_OUT };

// The CSP of the captcha page on the admin UI (location = /.npmpro/crowdsec-captcha of conf.d/npmpro.conf, which sends
// $npmpro_captcha_csp): the landing page CSP of the ban page, plus the origins of the one configured provider (its
// script, frame, requests, styles and images) and form-action 'self', since the form posts back to the page. Without a
// provider conf.d/npmpro.conf sets the ban page's CSP as the default and this file sets nothing. The hash is the one of
// backend/landing-pages/page-script.js (test/crowdsec-admin-pages.test.js keeps them equal).
// biome-ignore lint/security/noSecrets: a public CSP hash of a script, not a secret
const SCRIPT_HASH = "sha256-UMMDl3diDTKE9V5ubP1R7s9y1M3O5vKVc3mx70HVL24=";
const CAPTCHA_ORIGINS = {
	recaptcha: {
		script: ["https://www.recaptcha.net", "https://www.gstatic.com"],
		frame: ["https://www.recaptcha.net", "https://www.google.com", "https://recaptcha.google.com"],
		connect: ["https://www.recaptcha.net"],
		style: [],
		img: ["https://www.gstatic.com"],
	},
	hcaptcha: {
		script: ["https://js.hcaptcha.com", "https://hcaptcha.com", "https://*.hcaptcha.com"],
		frame: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
		connect: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
		style: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
		img: ["https://hcaptcha.com", "https://*.hcaptcha.com"],
	},
	turnstile: {
		script: ["https://challenges.cloudflare.com"],
		frame: ["https://challenges.cloudflare.com"],
		connect: ["https://challenges.cloudflare.com"],
		style: [],
		img: [],
	},
};

/**
 * @param   {string} provider  recaptcha, hcaptcha, turnstile or "" (none)
 * @returns {string|null} the CSP header value of the captcha page, or null without a known provider
 */
const captchaCsp = (provider) => {
	const origins = Object.hasOwn(CAPTCHA_ORIGINS, provider) ? CAPTCHA_ORIGINS[provider] : undefined;
	if (!origins) return null;
	const list = (head, hosts) => [head, ...hosts].join(" ");
	return [
		"default-src 'none'",
		list(`script-src '${SCRIPT_HASH}'`, origins.script),
		list("frame-src", origins.frame),
		list("connect-src", origins.connect),
		list("style-src 'unsafe-inline'", origins.style),
		list("img-src data:", origins.img),
		"font-src data:",
		"base-uri 'none'",
		"form-action 'self'",
		"frame-ancestors 'none'",
		"upgrade-insecure-requests;",
	].join("; ");
};

// crowdsec-admin.conf: the admin UI choice, then the captcha page's CSP when a provider is set
const adminInclude = (values) => {
	const csp = captchaCsp(values.captcha_provider);
	return (ADMIN_INCLUDES[values.admin_ui] ?? ADMIN_CHECKED) + (csp ? `set $npmpro_captcha_csp "${csp}";\n` : "");
};

/**
 * @param   {Object} values  effective values, secrets in plain text
 * @param   {Object} [options]
 * @param   {boolean} [options.bouncerOff]  write the include that leaves the bouncer off, whatever the values say
 * @returns {{ path: string, content: string }[]}
 */
const crowdsecFiles = (values, { bouncerOff = false } = {}) => [
	{ path: CROWDSEC_CONF_PATH, content: renderCrowdsecConf(values) },
	{ path: BOUNCER_INCLUDE, content: values.enabled && !bouncerOff ? INCLUDE_ON : INCLUDE_OFF },
	{ path: ADMIN_INCLUDE, content: adminInclude(values) },
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
 * @param   {{path: string, content: string, nginx?: true}[]} [deps.extraFiles]  written, tested and put back with them
 * @returns {Promise<*>} the result of fn
 */
const applyCrowdsecFiles = async (values, fn, { fs = nodeFs, log, bouncerOff = false, extraFiles = [] } = {}) => {
	await ensurePrivate(fs, CROWDSEC_CONF_PATH);
	return await withFiles([...crowdsecFiles(values, { bouncerOff }), ...extraFiles], fn, { fs, log });
};

/**
 * @param   {Object} [deps]
 * @returns {Promise<boolean>} whether nginx.conf's include turns the bouncer on
 */
const bouncerLoaded = async ({ fs = nodeFs } = {}) =>
	(await fs.readFile(BOUNCER_INCLUDE, "utf8").catch(() => "")) === INCLUDE_ON;

export {
	ADMIN_BANS,
	ADMIN_CHECKED,
	ADMIN_INCLUDE,
	ADMIN_INCLUDES,
	ADMIN_OUT,
	applyCrowdsecFiles,
	BOUNCER_INCLUDE,
	bouncerLoaded,
	captchaCsp,
	crowdsecFiles,
	INCLUDE_OFF,
	INCLUDE_ON,
};
