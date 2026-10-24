import { existsSync } from "node:fs";
import { stapledHost } from "./default-cert.js";
import { forwardAuthHost, proxyHostsForProvider } from "./forward-auth.js";

/**
 * "a.example, b.example and 3 more": the first domain of up to five hosts (#id without one)
 *
 * @param   {Object[]}  hosts
 * @returns {string}
 */
const describeHosts = (hosts) => {
	const names = hosts.slice(0, 5).map((host) => host.domain_names?.[0] ?? `#${host.id}`);
	const more = hosts.length - names.length;
	return more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", ");
};

/**
 * The host config re-render of the runtime apply
 *
 * @param   {Object}    deps
 * @param   {Array}     deps.hostTypes      [[model, hostType, graph]] (graph: the relations renderConfig needs)
 * @param   {Function}  deps.getConfigName  (hostType, id) => config file path
 * @param   {Function}  deps.renderConfig   (hostType, host, { env, fetchMissingOcsp }) => config text
 * @param   {Function}  [deps.exists]       (path) => boolean
 */
const createHostRenderer = ({ hostTypes, getConfigName, renderConfig, exists = existsSync }) => {
	/**
	 * Renders the configs of the enabled hosts that match, as files for the runtime apply transaction. A host
	 * without a config file (disabled, or kept as .err after nginx rejected it) is left alone, so a broken host
	 * cannot block the save.
	 *
	 * @param   {Function}  match  (host, hostType) => boolean
	 * @param   {Object}    env    the env the templates read
	 * @returns {Promise<Array<{path: string, content: string, nginx: true}>>}
	 */
	const renderMatchingHosts = async (match, env) => {
		const files = [];
		for (const [model, hostType, graph] of hostTypes) {
			for (const host of await model.query().where("enabled", 1).withGraphFetched(graph)) {
				if (!match(host, hostType)) continue;
				const file = getConfigName(hostType, host.id);
				if (!exists(file)) continue;
				// the apply fetched the OCSP responses already
				const content = await renderConfig(hostType, host, { env, fetchMissingOcsp: false });
				files.push({ path: file, content, nginx: true });
			}
		}
		return files;
	};

	/**
	 * renderHosts of the runtime applier: the host configs a changed reload key affects. At startup nothing is
	 * re-rendered: the host configs on disk were rendered with the stored values. When an env value the templates
	 * read, the list of runtime vars the env sets (NPMPRO_USER_ENV) or the template version changed, envs.sh sets
	 * REGENERATE_ALL, start.sh deletes the configs and setup.js regenerates them with effectiveEnv() after the
	 * startup apply.
	 *
	 * @param   {string}  group
	 * @param   {Object}  ctx  { changed, startup, env }
	 * @returns {Promise<Array>}
	 */
	const renderRuntimeHosts = (group, { changed, startup, env }) => {
		if (startup) return Promise.resolve([]);
		if (group === "certificates") return renderMatchingHosts((host) => stapledHost(host, changed), env);
		// proxy hosts using a provider whose default changed (and no own upstream for it), or Anubis for its images
		if (group === "forward-auth") {
			return renderMatchingHosts((host, type) => type === "proxy_host" && forwardAuthHost(host, changed), env);
		}
		return Promise.resolve([]);
	};

	/**
	 * The proxy hosts (enabled or not) that use the provider without their own upstream, so they need its default
	 *
	 * @param   {string}  provider
	 * @returns {Promise<Object[]>}
	 */
	const proxyHostsUsingDefault = async (provider) => {
		const hosts = [];
		for (const [model, hostType, graph] of hostTypes) {
			if (hostType !== "proxy_host") continue;
			hosts.push(...proxyHostsForProvider(await model.query().withGraphFetched(graph), provider));
		}
		return hosts;
	};

	return { proxyHostsUsingDefault, renderMatchingHosts, renderRuntimeHosts };
};

export { createHostRenderer, describeHosts };
