import { existsSync } from "node:fs";
import { readdir, rm, writeFile } from "node:fs/promises";
import dnsPlugins from "./certbot/dns-plugins.json" with { type: "json" };
import internalDnsCredential from "./internal/dns-credential.js";
import internalHost from "./internal/host.js";
import internalNginx from "./internal/nginx.js";
import internalProxyHost from "./internal/proxy-host.js";
import internalProxyHostAccessList from "./internal/proxy-host-access-list.js";
import { runtimeExclusive } from "./internal/runtime-queue.js";
import internalUser from "./internal/user.js";
import Access from "./lib/access.js";
import { installPlugins } from "./lib/certbot.js";
import { setup as logger } from "./logger.js";
import certificateModel from "./models/certificate.js";
import deadModel from "./models/dead_host.js";
import proxyModel from "./models/proxy_host.js";
import redirectionModel from "./models/redirection_host.js";
import settingModel from "./models/setting.js";
import streamModel from "./models/stream.js";
import userModel from "./models/user.js";

/**
 * Creates a default admin users if one doesn't already exist in the database
 *
 * @returns {Promise}
 */
const setupDefaultUser = async () => {
	const initialAdminEmail = process.env.INITIAL_ADMIN_EMAIL?.trim();
	const initialAdminPassword = process.env.INITIAL_ADMIN_PASSWORD;

	// This will only create a new user when there are no active users in the database
	// and the INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD environment variables are set.
	// Otherwise, users should be shown the setup wizard in the frontend.
	// I'm keeping this legacy behavior in case some people are automating deployments.

	if (!initialAdminEmail || !initialAdminPassword) {
		return;
	}

	const userIsetup = await isSetup();
	if (!userIsetup) {
		// Create a new user and set password
		logger.info(`Creating initial user: ${initialAdminEmail}`);

		const access = new Access(null);
		await access.load(true);

		await internalUser.create(access, {
			email: initialAdminEmail,
			name: "Administrator",
			roles: ["admin"],
			auth: {
				type: "password",
				secret: initialAdminPassword,
			},
		});
		logger.info(`Initial admin user creation completed: ${initialAdminEmail}`);
	}
};

/**
 * Creates default settings if they don't already exist in the database
 *
 * @returns {Promise}
 */
const setupDefaultSettings = async () => {
	if (!(await settingModel.query().select("id").where({ id: "default-site" }).first())?.id) {
		await settingModel.query().insert({
			id: "default-site",
			name: "Default Site",
			description: "What to show when Nginx is hit with an unknown Host",
			value: process.env.INITIAL_DEFAULT_PAGE || "congratulations",
			meta: {},
		});
		logger.info("Default settings added");
	}

	await settingModel.query().deleteById("oidc-config");

	await internalNginx.generateConfig("default", await settingModel.query().where({ id: "default-site" }).first());
};

/**
 * Installs all Certbot plugins which are required for an installed certificate
 *
 * @returns {Promise}
 */
const setupCertbotPlugins = async () => {
	const plugins = [];

	for (const certificate of await certificateModel.query().where("provider", "letsencrypt")) {
		if (certificate.npmpro_dns_challenge) {
			if (dnsPlugins[certificate.npmpro_dns_provider]?.package_name === undefined) {
				logger.warn(
					`Unknown DNS provider '${certificate.npmpro_dns_provider}' for Cert #${certificate.id}, skipping Certbot plugin installation`,
				);
			} else if (!plugins.includes(certificate.npmpro_dns_provider)) {
				plugins.push(certificate.npmpro_dns_provider);
			}

			try {
				await internalDnsCredential.writeCertificateFile(certificate);
			} catch (err) {
				logger.error(`Cert #${certificate.id}: ${err.message}`);
			}
		}
	}

	try {
		await installPlugins(plugins);
	} catch (err) {
		logger.error(err.message);
		return;
	}

	if (plugins.length > 0) {
		logger.info(`Added Certbot plugins ${plugins.join(", ")}`);
	}
};

const HOST_CONFIG_DIRS = ["proxy_host", "redirection_host", "dead_host", "stream"];

/**
 * Removes host configs that a full regeneration did not write: configs of hosts that were deleted or disabled, and the
 * configs launch.sh moved aside (*.conf.stale) because nginx rejected them
 *
 * @param   {Set<String>}  written  the config files the regeneration wrote
 * @returns {Promise}
 */
const removeLeftoverConfigs = async (written) => {
	for (const dir of HOST_CONFIG_DIRS) {
		const names = await readdir(`/data/nginx/${dir}`).catch(() => []);
		for (const name of names) {
			const file = `/data/nginx/${dir}/${name}`;
			if (name.endsWith(".conf.stale") || (name.endsWith(".conf") && !written.has(file))) {
				await rm(file, { force: true });
			}
		}
	}
};

/**
 * Full regeneration: writes every config (the previous ones stay in use until the reload), then one nginx -t. Only
 * when that fails, the hosts are checked one by one like a single save, so the broken ones end up as .err.
 *
 * @param   {Array<{model: Object, hostType: String, host: Object}>}  hosts
 * @returns {Promise}
 */
const regenerateAllHosts = (hosts) =>
	runtimeExclusive(async () => {
		const written = new Set();
		for (const { hostType, host } of hosts) {
			await internalProxyHostAccessList.build(hostType, host);
			await internalNginx.deleteConfig(hostType, host);
			// launch.sh and the startup apply fetched the OCSP responses, the reload afterwards fetches the rest once
			await internalNginx.generateConfig(hostType, host, { fetchMissingOcsp: false });
			written.add(internalNginx.getConfigName(hostType, host.id));
		}
		await removeLeftoverConfigs(written);

		try {
			await internalNginx.test();
		} catch (err) {
			logger.warn(`The regenerated configs do not pass nginx -t, checking the hosts one by one: ${err.message}`);
			for (const { hostType, host } of hosts) await internalNginx.deleteConfig(hostType, host);
			for (const { model, hostType, host } of hosts) {
				await internalNginx.configureNow(model, hostType, host, { skipReload: true, fetchMissingOcsp: false });
			}
			return;
		}
		const ok = { npmpro_nginx_online: true, npmpro_nginx_err: "" };
		for (const model of new Set(hosts.map(({ model }) => model))) {
			const ids = hosts.filter((entry) => entry.model === model).map(({ host }) => host.id);
			if (ids.length > 0) await model.query().whereIn("id", ids).patch(ok);
		}
	});

/**
 * Regenerates host configs. All enabled hosts when an env or the template version changed, otherwise only enabled
 * hosts whose config file is missing, e.g. because a previous start stopped before regenerating them.
 *
 * @returns {Promise}
 */
const regenerateHosts = async () => {
	const regenerateAll = process.env.REGENERATE_ALL === "true";
	const hostTypes = [
		[proxyModel, "proxy_host", "[access_lists.[clients,items],certificate,locations.access_lists.[clients,items]]"],
		[redirectionModel, "redirection_host", "certificate"],
		[deadModel, "dead_host", "certificate"],
		[streamModel, "stream", "certificate"],
	];

	if (regenerateAll) {
		const hosts = [];
		for (const [model, hostType, graph] of hostTypes) {
			for (const host of await model.query().where("enabled", 1).withGraphFetched(graph)) {
				hosts.push({ model, hostType, host });
			}
		}
		await regenerateAllHosts(hosts);
		await writeFile("/data/npmpro/env.sha512sum", process.env.ENV_SHA512SUM);
		logger.info(`Regenerated ${hosts.length} host config(s)`);
		await internalNginx.reload();
		return;
	}

	let regenerated = 0;
	for (const [model, hostType, graph] of hostTypes) {
		for (const host of await model.query().where("enabled", 1).withGraphFetched(graph)) {
			const configFile = internalNginx.getConfigName(hostType, host.id);
			// a config nginx rejected is kept as .err, regenerating it on every start would only fail again
			if (existsSync(configFile) || existsSync(`${configFile}.err`)) continue;
			// launch.sh and the startup apply fetched the OCSP responses, the reload below fetches the rest once
			await internalNginx.configure(model, hostType, host, { skipReload: true, fetchMissingOcsp: false });
			regenerated++;
		}
	}

	if (regenerated > 0) {
		logger.warn(`Regenerated ${regenerated} host config(s) that were missing`);
		await internalNginx.reload();
	}
};

/**
 * Creates the AIO proxy host if enabled and not already present
 *
 * @returns {Promise}
 */
const setupAio = async () => {
	const domain = process.env.NC_DOMAIN;
	if (process.env.NC_AIO !== "true" || !domain) return;
	if ((await internalHost.isHostnameTaken(domain)).is_taken) return;

	const access = new Access(null);
	await access.load(true);

	try {
		await internalProxyHost.create(access, {
			domain_names: [domain],
			forward_scheme: "http",
			forward_host: "127.0.0.1",
			forward_port: 11000,
			npmpro_crowdsec_appsec: true,
			npmpro_proxy_request_buffering: true,
			npmpro_proxy_response_buffering: true,
			npmpro_upstream_compression: true,
			certificate_id: "new",
			ssl_forced: true,
			hsts_enabled: true,
			hsts_subdomains: true,
			npmpro_http3_support: true,
		});
		logger.info("AIO proxy host created");
	} catch (err) {
		logger.error(`AIO proxy host setup failed, create it manually in the NPMpro UI: ${err.message}`);
	}
};

export const isSetup = async () => {
	const row = await userModel.query().select("id").first();
	return row?.id > 0;
};

export default async () => {
	await setupDefaultUser();
	await setupDefaultSettings();
	await setupCertbotPlugins();
	await regenerateHosts();
	await setupAio();
};
