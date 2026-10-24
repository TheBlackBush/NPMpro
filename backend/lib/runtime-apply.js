import nodeFs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Agent, fetch as undiciFetch } from "undici";
import { global as logger } from "../logger.js";
import { CERTBOT_INI, RENEWAL_DIR, renderCertbotIni, renewalProfileEdits } from "./certbot-ini.js";
import { DEFAULT_CERT_CONF, defaultCertificatePaths, renderDefaultCertConf, TLS_DIR } from "./default-cert.js";
import errs from "./error.js";
import { effectiveEnv as defaultEffectiveEnv, getRuntimeConfig as defaultGetRuntimeConfig } from "./runtime-config.js";
import { acmeServerOf, appliesOf, RUNTIME_GROUPS } from "./runtime-rules.js";

const PATHS = {
	certbotIni: CERTBOT_INI,
	renewalDir: RENEWAL_DIR,
	crontabDir: "/tmp/crontabs",
	defaultCertConf: DEFAULT_CERT_CONF,
	tlsDir: TLS_DIR,
};

const CERTBOT_KEYS = ["key_type", "key_size", "must_staple", "server_tls_verify", "profile"];
const DEFAULT_CERT_KEYS = ["default_certificate_id", "ocsp_stapling", "custom_ocsp_stapling"];
// stapling key, the OCSP fetcher kind and the env var launch.sh fetched with at boot
const OCSP_KINDS = [
	{ key: "ocsp_stapling", kind: "acme", env: "ACME_OCSP_STAPLING" },
	{ key: "custom_ocsp_stapling", kind: "custom", env: "CUSTOM_OCSP_STAPLING" },
];
const ECH_LINE = /^\S+ \S+ \S+ \S+ \S+ cron-ech\.sh$/u;
const PROFILE_TIMEOUT = 10_000;

const readOrNull = async (fs, file) => {
	try {
		return await fs.readFile(file, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
};

const modeOf = async (fs, file) => {
	try {
		return (await fs.stat(file)).mode % 0o10000;
	} catch {}
};

// A dot file next to the target: same file system for the rename, and crond skips dot files in its crontab folder
const tmpPathOf = (file) => path.join(path.dirname(file), `.${path.basename(file)}.npmpro-tmp`);

/**
 * Replaces the file in one step (temp file + rename), keeping the mode of the file it replaces
 */
const writeAtomic = async (fs, file, content) => {
	const tmp = tmpPathOf(file);
	const mode = await modeOf(fs, file);
	try {
		await fs.writeFile(tmp, content, mode === undefined ? undefined : { mode });
		if (mode !== undefined) await fs.chmod(tmp, mode);
		await fs.rename(tmp, file);
	} catch (err) {
		await fs.rm(tmp, { force: true }).catch(() => {});
		throw err;
	}
};

/**
 * Writes the files atomically, runs fn and puts the previous contents back (a file that did not exist is removed)
 * when a write or fn fails. A write failure throws a non-public error (500 "Internal Error"), the cause logged; an
 * error from fn is rethrown unchanged. Files that already have the content are not written.
 *
 * @param   {Array<{path: string, content: string}>}  files
 * @param   {Function}  [fn]           (changedPaths) => result, runs after all writes
 * @param   {Object}    [deps]
 * @param   {Object}    [deps.fs]      node:fs/promises compatible
 * @param   {Object}    [deps.log]
 * @returns {Promise<*>}  the result of fn
 */
const withFiles = async (files, fn = async () => {}, { fs = nodeFs, log = logger } = {}) => {
	const previous = [];
	for (const file of files) {
		try {
			previous.push(await readOrNull(fs, file.path));
		} catch (err) {
			log.error(`Could not read ${file.path}: ${err.message}`);
			throw new Error(`Could not read ${file.path}`, { cause: err });
		}
	}

	const written = [];
	const restore = async () => {
		for (const index of written.toReversed()) {
			const { path: file } = files[index];
			try {
				if (previous[index] === null) await fs.rm(file, { force: true });
				else await writeAtomic(fs, file, previous[index]);
			} catch (err) {
				log.error(`Could not restore ${file}: ${err.message}`);
			}
		}
	};

	for (const [index, file] of files.entries()) {
		if (previous[index] === file.content) continue;
		try {
			await writeAtomic(fs, file.path, file.content);
		} catch (err) {
			await restore();
			log.error(`Could not write ${file.path}: ${err.message}`);
			throw new Error(`Could not write ${file.path}`, { cause: err });
		}
		written.push(index);
	}

	try {
		return await fn(written.map((index) => files[index].path));
	} catch (err) {
		await restore();
		throw err;
	}
};

/**
 * nginx -t, then a reload unless reload is false; a failure becomes a ValidationError with the nginx message
 *
 * @param {Object}   nginx            { test, reload }
 * @param {Object}   [options]
 * @param {boolean}  [options.reload]
 */
const testAndReload = async (nginx, { reload = true } = {}) => {
	try {
		await nginx.test();
		if (reload) await nginx.reload();
	} catch (err) {
		throw new errs.ValidationError(err.message || "nginx config test failed", undefined, { cause: err });
	}
};

let insecureAgent;

/**
 * meta.profiles (and whether it is an ACME directory) of the ACME server directory, 10 s timeout
 *
 * @param   {string}   server            the directory URL
 * @param   {Object}   [options]
 * @param   {boolean}  [options.verify]  false: the server's TLS certificate is not verified (server_tls_verify)
 * @returns {Promise<{directory: boolean, profiles: Object}>}
 */
const fetchAcmeDirectory = async (server, { verify = true } = {}) => {
	const init = { headers: { accept: "application/json" }, signal: AbortSignal.timeout(PROFILE_TIMEOUT) };
	if (!verify) insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false } });
	const res = verify ? await fetch(server, init) : await undiciFetch(server, { ...init, dispatcher: insecureAgent });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const body = await res.json();
	const profiles = body?.meta?.profiles;
	return {
		directory: typeof body?.newNonce === "string",
		profiles: profiles !== null && typeof profiles === "object" ? profiles : {},
	};
};

const changedKeys = (next, prev) =>
	Object.keys(next).filter((key) => prev === undefined || !isDeepStrictEqual(next[key], prev[key]));

/**
 * Applies runtime settings: files (one transaction per group), nginx test and reload for keys with
 * applies=reload, timers
 *
 * @param   {Object}    deps
 * @param   {Object}    [deps.fs]            node:fs/promises compatible
 * @param   {Object}    deps.nginx           { test, reload }
 * @param   {Function}  [deps.renderHosts]   (group, ctx) => files [{ path, content, nginx? }] to write with the group's
 *                                           files (ctx: next, prev, changed, startup, env); called when a reload key
 *                                           changed
 * @param   {Object}    [deps.timers]        { restartRenewal(hours) }
 * @param   {Object}    [deps.log]
 * @param   {Object}    [deps.paths]         file locations (tests)
 * @param   {Function}  [deps.env]           () => process env, for ACME_SERVER
 * @param   {Function}  [deps.effectiveEnv]  lib/runtime-config effectiveEnv
 * @param   {Function}  [deps.getConfig]     lib/runtime-config getRuntimeConfig
 * @param   {Function}  [deps.fetchDirectory] (server) => { directory, profiles }
 * @param   {Function}  [deps.listCertificates] () => [{ id }], the certificates that exist (default certificate)
 * @param   {Object}    [deps.ocsp]           { fetch(kind) } fetches the OCSP responses of "acme" or "custom" certificates
 */
const createRuntimeApplier = ({
	fs = nodeFs,
	nginx,
	renderHosts = async () => [],
	timers = {},
	log = logger,
	paths = PATHS,
	env = () => process.env,
	effectiveEnv = defaultEffectiveEnv,
	getConfig = defaultGetRuntimeConfig,
	fetchDirectory = fetchAcmeDirectory,
	listCertificates = async () => [],
	ocsp = { fetch: async () => {} },
} = {}) => {
	const logged = new Set();
	const logOnce = (id, message) => {
		if (logged.has(id)) return;
		logged.add(id);
		log.warn(message);
	};

	const checkProfile = async (profile, verify) => {
		const server = acmeServerOf(env());
		let result;
		try {
			result = await fetchDirectory(server, { verify });
		} catch (err) {
			log.warn(`Could not read the ACME server directory ${server}: ${err.message}`);
			throw new errs.ValidationError("Could not check the ACME server profiles", undefined, { cause: err });
		}
		if (Object.hasOwn(result.profiles, profile)) return;
		if (!result.directory) throw new errs.ValidationError("Could not check the ACME server profiles");
		throw new errs.ValidationError("The ACME server does not offer this profile");
	};

	/**
	 * The crontab launch.sh writes (one file in the crontab folder, named after the user) with the ECH line for the
	 * interval; null when there is none
	 */
	const echCrontab = async (hours) => {
		let names;
		try {
			names = (await fs.readdir(paths.crontabDir)).filter((name) => !name.startsWith("."));
		} catch (err) {
			if (err.code !== "ENOENT") throw err;
			names = [];
		}
		const contents = [];
		for (const name of names.toSorted((a, b) => a.localeCompare(b))) {
			const file = path.join(paths.crontabDir, name);
			contents.push({ file, content: await fs.readFile(file, "utf8") });
		}
		const found = contents.find(({ content }) => content.split("\n").some((line) => ECH_LINE.test(line)));
		const target = found ?? (contents.length === 1 ? contents[0] : undefined);
		if (!target) {
			logOnce(
				"crontab",
				`No crontab in ${paths.crontabDir}, the ECH key rotation interval applies at the next container start`,
			);
			return null;
		}
		const echLine = `0 */${hours} * * * cron-ech.sh`;
		const lines = target.content.split("\n");
		const index = lines.findIndex((entry) => ECH_LINE.test(entry));
		if (index === -1) lines.unshift(echLine);
		else lines[index] = echLine;
		return { path: target.file, content: lines.join("\n") };
	};

	/**
	 * Fetches the OCSP responses for a stapling kind that is now on, before the configs that name the .der files are
	 * tested: on save when it was off, at startup when launch.sh did not fetch them (the env value was not true)
	 */
	const fetchStapling = async ({ next, prev, startup }) => {
		for (const { key, kind, env: name } of OCSP_KINDS) {
			if (next[key] !== true) continue;
			if (startup ? env()[name] === "true" : prev[key] === true) continue;
			// forced: an attempt in the last 10 minutes (stapling on, off and on again, a host render) must not skip it
			await ocsp.fetch(kind, { force: true });
		}
	};

	/**
	 * The default certificate include for the values; a certificate that no longer exists (or whose files are
	 * missing) gives the built-in certificate, logged once
	 */
	const defaultCertConf = async (next, { strict }) => {
		const id = next.default_certificate_id;
		const certificates = id === 0 ? [] : await listCertificates();
		const files = await defaultCertificatePaths(id, certificates, {
			stapling: { acme: next.ocsp_stapling, custom: next.custom_ocsp_stapling },
			fs,
			tlsDir: paths.tlsDir,
		});
		if (id !== 0 && files === null) {
			const known = certificates.some((certificate) => certificate.id === id);
			// on save a new default certificate must be usable, at startup the built-in one is the fallback
			if (strict) {
				throw new errs.ValidationError(
					known
						? "default_certificate_id: the certificate files are missing"
						: "default_certificate_id: Certificate not found",
				);
			}
			logOnce(
				`default-cert-${id}-${known}`,
				known
					? `The files of the default certificate #${id} are missing, the built-in certificate is used`
					: `The default certificate #${id} does not exist (deleted?), the built-in certificate is used`,
			);
		}
		return renderDefaultCertConf(files, paths.tlsDir);
	};

	const planners = {
		certificates: async ({ next, prev, changed, startup }) => {
			const plan = { files: [], after: [] };
			if (CERTBOT_KEYS.some((key) => changed.includes(key))) {
				plan.files.push({ path: paths.certbotIni, content: renderCertbotIni(next) });
			}
			if (changed.includes("profile")) {
				if (next.profile && !startup) plan.check = () => checkProfile(next.profile, next.server_tls_verify);
				// renewal conf profile lines go on any profile change on save, at startup only for an empty profile
				if (!next.profile || !startup) plan.files.push(...(await renewalProfileEdits(paths.renewalDir, fs)));
			}
			if (changed.includes("ech_rotation_interval")) {
				const crontab = await echCrontab(next.ech_rotation_interval);
				if (crontab) plan.files.push(crontab);
			}
			if (DEFAULT_CERT_KEYS.some((key) => changed.includes(key))) {
				await fetchStapling({ next, prev, startup });
				const strict = !startup && changed.includes("default_certificate_id");
				// default.conf and npmpro.conf include it, so they need no re-render; at startup its own transaction, so a
				// failing nginx -t only puts start.sh's include back
				plan.files.push({
					path: paths.defaultCertConf,
					content: await defaultCertConf(next, { strict }),
					nginx: true,
					startupOwn: true,
				});
			}
			if (changed.includes("renewal_interval") && timers.restartRenewal) {
				plan.after.push(() => timers.restartRenewal(next.renewal_interval));
			}
			return plan;
		},
	};

	/**
	 * Applies a group's values. Without prev (startup) every key counts as changed, nginx is only tested (the
	 * caller reloads) and only when a file marked nginx changed. Inside the save hook getRuntimeConfig() still
	 * returns the saved values: everything here works from next.
	 *
	 * @param   {string}  group
	 * @param   {Object}  next   the merged values to apply (env-locked keys hold the env value)
	 * @param   {Object}  [prev] the values in effect
	 * @returns {Promise<{changed: string[], reloaded: boolean}>}
	 */
	const applyGroup = async (group, next, prev) => {
		const startup = prev === undefined;
		const changed = changedKeys(next, prev);
		if (changed.length === 0) return { changed, reloaded: false };

		const plan = (await planners[group]?.({ next, prev, changed, startup })) ?? {};
		if (plan.check) await plan.check();

		const applies = appliesOf(group);
		const reloadKeys = changed.some((key) => applies[key] === "reload");
		const files = [...(plan.files ?? [])];
		if (reloadKeys) {
			const hostEnv = effectiveEnv({ [group]: next });
			files.push(...((await renderHosts(group, { next, prev, changed, startup, env: hostEnv })) ?? []));
		}
		let reloaded = false;
		if (startup) {
			// a file marked startupOwn is applied after the others (and the timers), alone: its nginx -t failure
			// restores only that file
			const testIfNginx = (batch) => async (written) => {
				const nginxFiles = new Set(batch.filter((file) => file.nginx).map((file) => file.path));
				if (written.some((file) => nginxFiles.has(file))) await testAndReload(nginx, { reload: false });
			};
			const shared = files.filter((file) => !file.startupOwn);
			await withFiles(shared, testIfNginx(shared), { fs, log });
			for (const step of plan.after ?? []) await step();
			for (const file of files.filter((entry) => entry.startupOwn)) {
				await withFiles([file], testIfNginx([file]), { fs, log });
			}
			return { changed, reloaded };
		}

		await withFiles(
			files,
			async () => {
				if (reloadKeys) {
					await testAndReload(nginx);
					reloaded = true;
				}
			},
			{ fs, log },
		);
		// after steps (timers) run before the settings are stored and are not rolled back when the store fails
		for (const step of plan.after ?? []) await step();
		return { changed, reloaded };
	};

	/**
	 * Startup: applies every group from the loaded runtime config (env wins for env-set keys); a failing group is
	 * logged and the others still apply
	 *
	 * @returns {Promise<Object>}  { [group]: Error } for the groups that failed
	 */
	const applyAll = async () => {
		const failed = {};
		for (const group of RUNTIME_GROUPS) {
			try {
				const { values } = await getConfig(group);
				await applyGroup(group, values);
			} catch (err) {
				failed[group] = err;
				log.error(`Could not apply the ${group} runtime settings at startup: ${err.message}`);
			}
		}
		return failed;
	};

	return { applyAll, applyGroup };
};

export { createRuntimeApplier, fetchAcmeDirectory, PATHS, testAndReload, withFiles };
