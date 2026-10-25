import dnsPlugins from "../certbot/dns-plugins.json" with { type: "json" };
import { certbot as logger } from "../logger.js";
import errs from "./error.js";
import utils from "./utils.js";

// the exact versions of certbot and its dependencies in the image (Dockerfile, pip freeze): a plugin can never
// change them
const CERTBOT_CONSTRAINTS = "/usr/local/share/npmpro/certbot-constraints.txt";

// what certbot and pip get from the backend's environment: no database, cookie, OIDC or ACME secrets
const CERTBOT_ENV_KEYS = [
	"PATH",
	"HOME",
	"TZ",
	"LANG",
	"LC_ALL",
	"PIP_USER",
	"PYTHONUSERBASE",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"REQUESTS_CA_BUNDLE",
];

/**
 * @param   {Object} [env]  defaults to process.env
 * @returns {Object}        only the CERTBOT_ENV_KEYS that are set
 */
const certbotEnv = (env = process.env) =>
	Object.fromEntries(CERTBOT_ENV_KEYS.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));

/**
 * Runs certbot with the minimal environment
 *
 * @param   {String[]} args
 * @returns {Promise<String>}
 */
const runCertbot = (args) => utils.execFile("certbot", args, { env: certbotEnv() });

/**
 * The pip arguments that install a plugin: its pinned version, against the image's certbot versions, never upgrading
 * anything already installed
 *
 * @param   {Object} plugin  an entry of ../certbot/dns-plugins.json
 * @returns {String[]}
 */
const pluginInstallArgs = (plugin) => [
	"install",
	"--no-cache-dir",
	"--constraint",
	CERTBOT_CONSTRAINTS,
	`${plugin.package_name}==${plugin.version}`,
];

/**
 * A deprecated provider (its service is gone, or its plugin needs an older certbot than the image's) keeps working
 * for what already uses it, but is not offered for new certificates and DNS credentials
 *
 * @param {String} pluginKey
 */
const assertProviderForNew = (pluginKey) => {
	if (dnsPlugins[pluginKey]?.deprecated === true) {
		throw new errs.ValidationError(
			`The DNS provider ${dnsPlugins[pluginKey].name} is no longer supported for new certificates`,
		);
	}
};

/**
 * Installs a cerbot plugin given the key for the object from
 * ../certbot/dns-plugins.json
 *
 * @param   {string}  pluginKey
 * @returns {Object}
 */
const installPlugin = async (pluginKey) => {
	if (dnsPlugins[pluginKey]?.package_name === undefined) {
		// throw Error(`Certbot plugin ${pluginKey} not found`);
		throw new errs.ItemNotFoundError(pluginKey);
	}

	const plugin = dnsPlugins[pluginKey];
	logger.start(`Installing ${pluginKey}...`);

	const result = await utils.execFile("pip", pluginInstallArgs(plugin), { env: certbotEnv() });

	logger.complete(`Installed ${pluginKey}`);
	return result;
};

/**
 * @param {array} pluginKeys
 */
const installPlugins = async (pluginKeys) => {
	let failed;
	for (const pluginKey of pluginKeys) {
		try {
			await installPlugin(pluginKey);
		} catch (err) {
			logger.error(err.message);
			failed ??= err;
		}
	}
	if (failed) {
		throw new errs.CommandError("Some plugins failed to install. Please check the logs above", { cause: failed });
	}
};

export {
	assertProviderForNew,
	CERTBOT_CONSTRAINTS,
	CERTBOT_ENV_KEYS,
	certbotEnv,
	installPlugin,
	installPlugins,
	pluginInstallArgs,
	runCertbot,
};
