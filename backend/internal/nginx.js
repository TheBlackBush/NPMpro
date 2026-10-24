import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { domainToASCII } from "node:url";
import { Client, fetch } from "undici";
import errs from "../lib/error.js";
import { AUTH_REQUEST_PROVIDERS, ownUpstream, usesProvider } from "../lib/forward-auth.js";
import { fetchOcsp, staplingFileReady } from "../lib/ocsp-fetch.js";
import { beautifierOn, effectiveEnv } from "../lib/runtime-config.js";
import utils from "../lib/utils.js";
import { nginx as logger } from "../logger.js";
import internalProxyHostAccessList from "./proxy-host-access-list.js";
import { runtimeExclusive } from "./runtime-queue.js";

const controlApi = new Client("http://localhost", { connect: { socketPath: "/run/nginx-control.sock" } });

const internalNginx = {
	/**
	 * This will:
	 * - test the nginx config first to make sure it's OK
	 * - create / recreate the config for the host
	 * - test again
	 * - IF OK:  save the online status
	 * - IF BAD: save the offline status and rename the config
	 * - then reload nginx
	 *
	 * Runs in the runtime settings queue: a runtime save cannot test or restore host configs meanwhile, and the
	 * render reads the values of the last finished save.
	 *
	 * @param   {Object|String}  model
	 * @param   {String}         host_type
	 * @param   {Object}         host
	 * @returns {Promise}
	 */
	configure: async (model, host_type, host, options = {}) => {
		// skip disabled hosts
		if (!host.enabled) return {};
		return await runtimeExclusive(() => internalNginx.configureNow(model, host_type, host, options));
	},

	/**
	 * configure without the queue; only for code that runs in the runtime settings queue already
	 */
	configureNow: async (model, host_type, host, { skipReload = false, fetchMissingOcsp = true } = {}) => {
		let status = {};

		await internalProxyHostAccessList.build(host_type, host);
		await internalNginx.deleteConfig(host_type, host);
		await internalNginx.generateConfig(host_type, host, { fetchMissingOcsp });

		try {
			await (skipReload ? internalNginx.test() : internalNginx.reload());
			status = { npmpro_nginx_online: true, npmpro_nginx_err: "" };

			await model.query().where("id", host.id).patch(status);
		} catch (err) {
			logger.error(err.message);

			// config is bad, update status and rename config
			status = { npmpro_nginx_online: false, npmpro_nginx_err: err.message };

			await model.query().where("id", host.id).patch(status);

			await internalNginx.renameConfigAsError(host_type, host);
			if (!skipReload) await internalNginx.reload();
		}

		return status;
	},

	/**
	 * @returns {Promise}
	 */
	test: () => utils.execFile("nginx", ["-tq"]),

	/**
	 * Fetches the missing or outdated OCSP responses (.der stapling files) of the certbot ("acme") or custom
	 * certificates. Bounded per kind (lib/ocsp-fetch.js): concurrent calls share one run, a call within 10 minutes of
	 * the last attempt is skipped unless force is set (stapling switched on), a run is stopped after 60 s (with its
	 * child processes); a failure is logged with the kind. Hosts and the default include staple only when their .der
	 * file exists; a fetch that brings new .der files (onNewResponses) starts the stapling recovery
	 * (internal/stapling-recovery.js), which re-renders the configs written without them.
	 *
	 * @param   {"acme"|"custom"} kind
	 * @param   {Object}  [options]  { force }
	 * @returns {Promise<void>}
	 */
	fetchOcsp,

	/**
	 * @returns {Promise}
	 */
	reload: async () => {
		const env = effectiveEnv();
		if (env.ACME_OCSP_STAPLING === "true") await internalNginx.fetchOcsp("acme");
		if (env.CUSTOM_OCSP_STAPLING === "true") await internalNginx.fetchOcsp("custom");

		const res = await fetch("http://localhost/1/control/config", { method: "PATCH", dispatcher: controlApi });
		const logs = (await res.json()).logs.join("").trim();
		if (!res.ok) {
			throw new errs.CommandError(logs || `nginx reload failed with status ${res.status}, see container logs`);
		}
		return logs;
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Integer} host_id
	 * @returns {String}
	 */
	getConfigName: (host_type, host_id) => {
		if (host_type === "default") {
			return "/usr/local/nginx/conf/conf.d/default.conf";
		}
		return `/data/nginx/${host_type}/${host_id}.conf`;
	},

	/**
	 * Generates custom locations
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	renderLocations: async (host) => {
		const template = await readFile(`${import.meta.dirname}/../templates/_proxy_host_custom_location.conf`, {
			encoding: "utf8",
		});

		const renderEngine = utils.getRenderEngine();
		let renderedLocations = "";

		for (const [idx, location] of (host.locations || []).entries()) {
			if (location.npmpro_enabled === false) {
				continue;
			}

			if (
				location.forward_host?.includes("/") &&
				!location.forward_host.startsWith("/") &&
				!location.forward_host.startsWith("unix")
			) {
				const split = location.forward_host.split("/");

				location.forward_host = split.shift();
				location.forward_path = `/${split.join("/")}`;
			}

			if (location.forward_host?.startsWith("cu_")) {
				location.forward_upstream_name = location.forward_host;
			} else {
				location.forward_upstream_name = `upstream_${host.id}_location_${idx}`;
			}
			renderedLocations += await renderEngine.parseAndRender(template, location);
		}

		return renderedLocations;
	},

	/**
	 * Generates upstream blocks for main host and custom locations
	 * @param   {Object}  host
	 * @returns {Promise}
	 */
	renderUpstreams: async (host) => {
		const template = await readFile(`${import.meta.dirname}/../templates/_upstream.conf`, {
			encoding: "utf8",
		});

		const renderEngine = utils.getRenderEngine();
		let renderedUpstreams = "";

		if (["http", "https", "grpc", "grpcs"].includes(host.forward_scheme)) {
			if (
				host.forward_host?.includes("/") &&
				!host.forward_host.startsWith("/") &&
				!host.forward_host.startsWith("unix")
			) {
				const split = host.forward_host.split("/");
				host.forward_host = split.shift();
				host.forward_path = `/${split.join("/")}`;
			}

			if (host.forward_host?.startsWith("cu_")) {
				host.forward_upstream_name = host.forward_host;
			} else {
				host.forward_upstream_name = `upstream_${host.id}`;
				renderedUpstreams += await renderEngine.parseAndRender(template, host);
			}
		}

		for (const [idx, location] of (host.locations || []).entries()) {
			if (location.npmpro_enabled === false) {
				continue;
			}

			if (!["http", "https", "grpc", "grpcs"].includes(location.forward_scheme)) {
				continue;
			}

			if (
				location.forward_host?.includes("/") &&
				!location.forward_host.startsWith("/") &&
				!location.forward_host.startsWith("unix")
			) {
				const split = location.forward_host.split("/");
				location.forward_host = split.shift();
				location.forward_path = `/${split.join("/")}`;
			}

			if (location.forward_host?.startsWith("cu_")) {
				location.forward_upstream_name = location.forward_host;
			} else {
				location.forward_upstream_name = `upstream_${host.id}_location_${idx}`;
				renderedUpstreams += await renderEngine.parseAndRender(template, location);
			}
		}

		return renderedUpstreams;
	},

	/**
	 * Runs nginxbeautifier on a copy of the config in a temp folder; the text as it is when that fails
	 *
	 * @param   {String}  text
	 * @returns {Promise<String>}
	 */
	beautify: async (text) => {
		const dir = await mkdtemp(path.join(tmpdir(), "npmpro-beautify-"));
		const file = path.join(dir, "host.conf");
		try {
			await writeFile(file, text, { encoding: "utf8" });
			await utils.execFile("nginxbeautifier", ["-s", "2", file]);
			return await readFile(file, "utf8");
		} catch {
			return text;
		} finally {
			await rm(dir, { force: true, recursive: true });
		}
	},

	/**
	 * Renders the config of a host without writing it
	 *
	 * @param   {String}  host_type
	 * @param   {Object}  host_row
	 * @param   {Object}  [options]
	 * @param   {Object}  [options.env]  env the template reads as env.*, default effectiveEnv() (an apply passes the
	 *                                   values it is about to save)
	 * @param   {boolean} [options.fetchMissingOcsp]  stapling on and no OCSP response yet (a new certificate): fetch
	 *                                   them first; false when the caller already fetched (runtime apply)
	 * @returns {Promise<String>}
	 */
	renderConfig: async (host_type, host_row, { env, fetchMissingOcsp = true } = {}) => {
		// Prevent modifying the original object:
		const host = structuredClone(host_row);

		const renderEngine = utils.getRenderEngine();

		host.env = env ?? effectiveEnv();

		// the templates staple only when the OCSP response file exists (not every CA runs an OCSP responder)
		host.npmpro_stapling_file_exists = await staplingFileReady(host, host.env, {
			fetchMissingOcsp,
			fetch: internalNginx.fetchOcsp,
		});

		if (
			host.forward_host?.includes("/") &&
			!host.forward_host.startsWith("/") &&
			!host.forward_host.startsWith("unix")
		) {
			const split = host.forward_host.split("/");
			host.forward_host = split.shift();
			host.forward_path = `/${split.join("/")}`;
		}

		if (host.domain_names) {
			host.server_names = host.domain_names.map((domain_name) => domainToASCII(domain_name) || domain_name);
		}
		if (host.npmpro_access_list_type === "custom") {
			// note that there is access_lists -> an array in the correct order
			// and access_list -> an object used in the config generation
			// note the (s) in the former and lack thereof in the latter
			host.access_list = internalProxyHostAccessList.buildAclFile(host.access_lists);
		}
		const hostHtpasswdFileName = internalProxyHostAccessList.getHostFileName(host);
		if (hostHtpasswdFileName.length > 0) {
			host.filename = hostHtpasswdFileName;
		}

		host.upstreams = await internalNginx.renderUpstreams(host);

		if (host.locations) {
			for (const location of host.locations) {
				if (location.npmpro_access_list_type === "global") {
					location.access_list = host.access_list;
				} else if (location.npmpro_access_list_type === "custom") {
					// note that there is access_lists -> an array in the correct order
					// and access_list -> an object used in the config generation
					// note the (s) in the former and lack thereof in the latter
					location.access_list = internalProxyHostAccessList.buildAclFile(location.access_lists);
				}

				const htpasswdFileName = internalProxyHostAccessList.getLocationFileName(host, location);
				if (htpasswdFileName.length > 0) {
					location.filename = htpasswdFileName;
				}
			}

			// the host's or a location's own upstream; empty: the template uses the Forward authentication default
			for (const provider of AUTH_REQUEST_PROVIDERS) {
				if (usesProvider({ locations: host.locations }, provider)) host[`create_${provider}_locations`] = true;
				host[`auth_request_${provider}_upstream_resolved`] = ownUpstream(host, provider);
			}

			host.locations = await internalNginx.renderLocations(host);
		}

		const config_text = await renderEngine.parseAndRender(
			await readFile(`${import.meta.dirname}/../templates/${host_type}.conf`, { encoding: "utf8" }),
			host,
		);

		// the beautifier switch of the render's env (advanced.config_beautifier, also inside a runtime save)
		return beautifierOn(host.env) ? internalNginx.beautify(config_text) : config_text;
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  host_row
	 * @param   {Object}  [options]
	 * @param   {boolean} [options.fetchMissingOcsp]  see renderConfig
	 * @returns {Promise}
	 */
	generateConfig: async (host_type, host_row, { fetchMissingOcsp = true } = {}) => {
		const filename = internalNginx.getConfigName(host_type, host_row.id);
		const text = await internalNginx.renderConfig(host_type, host_row, { fetchMissingOcsp });
		await writeFile(filename, text, { encoding: "utf8" });
		logger.debug("Wrote config:", filename);
		return true;
	},

	/**
	 * Deletes a host's config (disable, delete) and reloads nginx, in the runtime settings queue (a runtime save
	 * cannot put the config back meanwhile)
	 *
	 * @param   {String}    host_type
	 * @param   {Object}    host
	 * @param   {Object}    [options]
	 * @param   {Function}  [options.also]  runs after the delete, before the reload (access list files)
	 * @returns {Promise}
	 */
	removeConfig: (host_type, host, { also } = {}) =>
		runtimeExclusive(async () => {
			await internalNginx.deleteConfig(host_type, host);
			await also?.();
			await internalNginx.reload();
		}),

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  [host]
	 * @returns {Promise}
	 */
	deleteConfig: async (host_type, host) => {
		const config_file = internalNginx.getConfigName(host_type, host?.id ?? 0);

		await rm(config_file, { force: true });
		await rm(`${config_file}.err`, { force: true });
	},

	/**
	 * @param   {String}  host_type
	 * @param   {Object}  [host]
	 * @returns {Promise}
	 */
	renameConfigAsError: async (host_type, host) => {
		const config_file = internalNginx.getConfigName(host_type, host?.id ?? 0);

		await rename(config_file, `${config_file}.err`);
	},
};

export default internalNginx;
