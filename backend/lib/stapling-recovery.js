import nodeFs from "node:fs/promises";
import { global as logger } from "../logger.js";
import {
	DEFAULT_CERT_CONF,
	defaultCertificatePaths,
	hasStaplingFile,
	renderDefaultCertConf,
	staplingFileOf,
	TLS_DIR,
} from "./default-cert.js";
import { testAndReload, withFiles } from "./runtime-apply.js";

const STAPLING_LINE = "ssl_stapling_file";

const readOrNull = async (fs, file) => {
	try {
		return await fs.readFile(file, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
};

/**
 * Turns OCSP stapling on for configs that were written while their OCSP response (.der file) did not exist yet. A
 * host and the default certificate include staple only when the .der file exists at render time; bulk renders, the
 * 10 minute fetch bound or a responder that was briefly down leave them without stapling, and nothing else renders
 * them again once a later fetch creates the file (must-staple certificates are then refused by browsers).
 *
 * recover() looks, in the runtime settings queue, for enabled hosts (and the default certificate include) whose
 * stapling kind is on, whose .der file now exists and whose config on disk has no ssl_stapling_file line; it
 * renders them again and writes them in one transaction with one nginx -t and one reload. A failure is logged and
 * the previous configs are put back. A config whose new render still has no stapling is not written; it is only
 * looked at again on the next call (after the next fetch that brought new .der files), so this cannot loop.
 *
 * @param   {Object}    deps
 * @param   {Array}     deps.hostTypes         [[model, hostType, graph]]
 * @param   {Function}  deps.getConfigName     (hostType, id) => config file path
 * @param   {Function}  deps.renderConfig      (hostType, host, { env, fetchMissingOcsp }) => config text
 * @param   {Object}    deps.nginx             { test, reload }
 * @param   {Function}  deps.exclusive         (fn) => runs fn in the runtime settings queue
 * @param   {Function}  deps.effectiveEnv      () => the env the templates read
 * @param   {Function}  deps.getConfig         (group) => { values }, the effective runtime settings
 * @param   {Function}  [deps.listCertificates] () => [{ id }], the certificates that can be the default one
 * @param   {Object}    [deps.fs]
 * @param   {string}    [deps.tlsDir]
 * @param   {string}    [deps.defaultCertConf]
 * @param   {Object}    [deps.log]
 * @returns {{recover: () => Promise<string[]>}}  recover resolves with the written paths and never rejects
 */
const createStaplingRecovery = ({
	hostTypes,
	getConfigName,
	renderConfig,
	nginx,
	exclusive,
	effectiveEnv,
	getConfig,
	listCertificates = async () => [],
	fs = nodeFs,
	tlsDir = TLS_DIR,
	defaultCertConf = DEFAULT_CERT_CONF,
	log = logger,
}) => {
	const hostFiles = async (env) => {
		const files = [];
		for (const [model, hostType, graph] of hostTypes) {
			for (const host of await model.query().where("enabled", 1).withGraphFetched(graph)) {
				const stapling = staplingFileOf(host, tlsDir);
				if (stapling === null || env[stapling.env] !== "true") continue;
				if (!(await hasStaplingFile(host, { fs, tlsDir }))) continue;
				const file = getConfigName(hostType, host.id);
				// no config: disabled meanwhile, kept as .err after nginx rejected it, or not generated yet
				const current = await readOrNull(fs, file);
				if (current === null || current.includes(STAPLING_LINE)) continue;
				const content = await renderConfig(hostType, host, { env, fetchMissingOcsp: false });
				if (!content.includes(STAPLING_LINE)) continue;
				files.push({ path: file, content });
			}
		}
		return files;
	};

	const defaultCertFile = async () => {
		const { values } = await getConfig("certificates");
		if (values.default_certificate_id === 0 || !(values.ocsp_stapling || values.custom_ocsp_stapling)) return [];
		const paths = await defaultCertificatePaths(values.default_certificate_id, await listCertificates(), {
			stapling: { acme: values.ocsp_stapling, custom: values.custom_ocsp_stapling },
			fs,
			tlsDir,
		});
		if (!paths?.stapling) return [];
		const current = await readOrNull(fs, defaultCertConf);
		if (current === null || current.includes(STAPLING_LINE)) return [];
		return [{ path: defaultCertConf, content: renderDefaultCertConf(paths, tlsDir) }];
	};

	const run = async () => {
		try {
			const env = effectiveEnv();
			if (env.ACME_OCSP_STAPLING !== "true" && env.CUSTOM_OCSP_STAPLING !== "true") return [];
			const files = [...(await defaultCertFile()), ...(await hostFiles(env))];
			if (files.length === 0) return [];
			await withFiles(files, () => testAndReload(nginx), { fs, log });
			log.info(`OCSP stapling turned on for ${files.length} config(s) whose OCSP response arrived later`);
			return files.map((file) => file.path);
		} catch (err) {
			log.error(`Could not turn OCSP stapling on for configs whose OCSP response arrived later: ${err.message}`);
			return [];
		}
	};

	// a call while one waits in the queue shares it: that run has not looked at the files yet
	let waiting = null;
	const recover = () => {
		if (waiting) return waiting.promise;
		const entry = {};
		waiting = entry;
		entry.promise = exclusive(() => {
			if (waiting === entry) waiting = null;
			return run();
		});
		return entry.promise;
	};

	return { recover };
};

export { createStaplingRecovery };
