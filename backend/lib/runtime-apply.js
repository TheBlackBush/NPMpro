import nodeFs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Agent, fetch as undiciFetch } from "undici";
import { global as logger } from "../logger.js";
import { CERTBOT_INI, RENEWAL_DIR, renderCertbotIni, renewalProfileEdits } from "./certbot-ini.js";
import { DEFAULT_CERT_CONF, defaultCertificatePaths, renderDefaultCertConf, TLS_DIR } from "./default-cert.js";
import errs from "./error.js";
import { AUTH_REQUEST_PROVIDERS } from "./forward-auth.js";
import { ERROR_LOG_CONF, LOGROTATE_CONF, logIncludes, renderRotations, STREAM_LOG_CONF } from "./log-files.js";
import { effectiveEnv as defaultEffectiveEnv, getRuntimeConfig as defaultGetRuntimeConfig } from "./runtime-config.js";
import { describeHosts } from "./runtime-hosts.js";
import { acmeServerOf, appliesOf, RUNTIME_GROUPS } from "./runtime-rules.js";
import { ACCESS_LOG_CONF, accessLogDirective } from "./traffic/access-log.js";

const PATHS = {
	certbotIni: CERTBOT_INI,
	renewalDir: RENEWAL_DIR,
	crontabDir: "/tmp/crontabs",
	defaultCertConf: DEFAULT_CERT_CONF,
	tlsDir: TLS_DIR,
	ipRangesConf: "/usr/local/nginx/conf/conf.d/ip_ranges.conf",
	errorLogConf: ERROR_LOG_CONF,
	streamLogConf: STREAM_LOG_CONF,
	accessLogConf: ACCESS_LOG_CONF,
	logrotateConf: LOGROTATE_CONF,
	nginxDir: "/data/nginx",
};

// the log files Write log files turns on, created like start.sh does (mode 0600, /data/nginx/<name> symlinks)
const LOG_FILES = ["access.log", "error.log", "stream.log"];

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
 * @param   {Object}    [deps.ipRanges]       lib/ip-ranges instance: { render(env, ranges), ranges(), fetchCloudflare(),
 *                                            start(), stop() }; without it the network settings are only stored
 * @param   {Function}  [deps.proxyHostsUsingDefault] (provider) => proxy hosts (enabled or not) that use the
 *                                            provider without their own upstream
 * @param   {Function}  [deps.accessLogOn]    (writeLogFiles) => whether the http access log is on with these
 *                                            write_log_files and the current traffic statistics setting
 *                                            (lib/traffic/access-log createAccessLogSwitch().enabled)
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
	ipRanges = null,
	proxyHostsUsingDefault = async () => [],
	accessLogOn = async (writeLogFiles) => writeLogFiles === true,
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

	/**
	 * The Cloudflare ranges for ip_ranges.conf: fetched when Cloudflare is turned on by a save (a failure refuses the
	 * save) or none are known yet (a failure is logged, the timer tries again), else the last fetched ones. A revert
	 * never fetches: the last fetched ones, or null (none known: keep the file) when there are none.
	 */
	const cloudflareRanges = async ({ next, changed, startup, revert }) => {
		if (!next.trust_cloudflare) return [];
		const known = ipRanges.ranges();
		if (revert) return known.length > 0 ? known : null;
		const turnedOn = !startup && changed.includes("trust_cloudflare");
		if (!turnedOn && known.length > 0) return known;
		try {
			return await ipRanges.fetchCloudflare();
		} catch (err) {
			log.warn(`Could not fetch the Cloudflare IP ranges: ${err.message}`);
			if (turnedOn) {
				throw new errs.ValidationError(
					"trust_cloudflare: Could not fetch the Cloudflare IP ranges",
					undefined,
					{
						cause: err,
					},
				);
			}
			return known;
		}
	};

	/**
	 * Refuses clearing a provider's default upstream while proxy hosts use the provider without their own upstream
	 * (their configs would get an empty upstream)
	 */
	const checkClearedUpstreams = async ({ next, prev, changed }) => {
		for (const provider of AUTH_REQUEST_PROVIDERS) {
			const key = `${provider}_upstream`;
			if (!changed.includes(key) || next[key] || !prev[key]) continue;
			const hosts = await proxyHostsUsingDefault(provider);
			if (hosts.length > 0) {
				throw new errs.ValidationError(
					`${key}: still used by proxy hosts without their own upstream: ${describeHosts(hosts)}`,
				);
			}
		}
	};

	/**
	 * The live logrotate config with the rotations; null when start.sh did not create it (logged once)
	 */
	const logrotateFile = async (rotations) => {
		const content = await readOrNull(fs, paths.logrotateConf);
		if (content === null) {
			logOnce(
				"logrotate",
				`No ${paths.logrotateConf}, the number of log rotations applies at the next container start`,
			);
			return null;
		}
		return { path: paths.logrotateConf, content: renderRotations(content, rotations) };
	};

	/**
	 * Creates the missing log files (mode 0600, existing ones are kept as they are) and the missing compatibility
	 * symlinks /data/nginx/<name> -> logs/<name>, like start.sh with LOGROTATE=true; failures are logged, nginx still
	 * opens (and creates) the files itself
	 */
	const prepareLogFiles = async () => {
		const logsDir = path.join(paths.nginxDir, "logs");
		for (const name of LOG_FILES) {
			const file = path.join(logsDir, name);
			try {
				await fs.writeFile(file, "", { flag: "wx", mode: 0o600 });
			} catch (err) {
				if (err.code !== "EEXIST") log.warn(`Could not create ${file}: ${err.message}`);
			}
			const link = path.join(paths.nginxDir, name);
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

	const planners = {
		logs: async ({ next, changed }) => {
			const plan = { files: [] };
			if (changed.includes("write_log_files")) {
				// before the includes are written and tested
				if (next.write_log_files) await prepareLogFiles();
				const includes = logIncludes(next.write_log_files);
				const accessLog = accessLogDirective(await accessLogOn(next.write_log_files));
				// at startup each in its own transaction, like the default certificate include: a failing nginx -t
				// keeps start.sh's file and does not undo the others
				for (const [file, content] of [
					[paths.errorLogConf, includes.error],
					[paths.streamLogConf, includes.stream],
					[paths.accessLogConf, accessLog],
				]) {
					plan.files.push({
						path: file,
						content,
						nginx: true,
						startupOwn: true,
						startupFailure: `Could not write ${file} at startup (nginx -t failed or the file could not be written), the file from the container start stays in use`,
					});
				}
			}
			if (changed.includes("log_rotations")) {
				const file = await logrotateFile(next.log_rotations);
				if (file) plan.files.push(file);
			}
			return plan;
		},
		"forward-auth": (ctx) => (ctx.startup ? {} : { check: () => checkClearedUpstreams(ctx) }),
		network: async (ctx) => {
			if (!ipRanges) return {};
			const { next, changed } = ctx;
			const ranges = await cloudflareRanges(ctx);
			const plan = { files: [], after: [] };
			if (ranges === null) {
				log.warn(`No Cloudflare IP ranges known to put back, ${paths.ipRangesConf} is kept as it is`);
			} else {
				// at startup its own transaction after the timer started: a failing nginx -t keeps the previous file only
				plan.files.push({
					path: paths.ipRangesConf,
					content: await ipRanges.render(effectiveEnv({ network: next }), ranges),
					nginx: true,
					startupOwn: true,
					startupFailure: `Could not write ${paths.ipRangesConf} at startup (nginx -t failed or the file could not be written), the previous trusted IP ranges stay in use`,
				});
			}
			if (changed.includes("trust_cloudflare")) {
				plan.after.push(() => (next.trust_cloudflare ? ipRanges.start() : ipRanges.stop()));
			}
			return plan;
		},
		certificates: async ({ next, prev, changed, startup, revert }) => {
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
				// a revert puts the stored certificate back even when it was deleted meanwhile (built-in fallback)
				const strict = !startup && !revert && changed.includes("default_certificate_id");
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
	 * @param   {Object}  [options]
	 * @param   {boolean} [options.revert]  putting the stored values back after a failed save: no checks, no strict
	 *                                      default certificate check, no Cloudflare fetch
	 * @returns {Promise<{changed: string[], reloaded: boolean}>}
	 */
	const applyGroup = async (group, next, prev, { revert = false } = {}) => {
		const startup = prev === undefined;
		const changed = changedKeys(next, prev);
		if (changed.length === 0) return { changed, reloaded: false };

		const plan = (await planners[group]?.({ next, prev, changed, startup, revert })) ?? {};
		if (plan.check && !revert) await plan.check();

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
			// a failing shared batch (a crontab write) does not stop the timers and the own files; the first error
			// fails the group at the end
			let failure;
			const shared = files.filter((file) => !file.startupOwn);
			try {
				await withFiles(shared, testIfNginx(shared), { fs, log });
			} catch (err) {
				failure = err;
			}
			for (const step of plan.after ?? []) {
				try {
					await step();
				} catch (err) {
					// the first error is logged by the caller
					if (failure) log.error(`Could not run a ${group} startup step: ${err.message}`);
					failure ??= err;
				}
			}
			// a failing one does not stop the next ones
			for (const file of files.filter((entry) => entry.startupOwn)) {
				try {
					await withFiles([file], testIfNginx([file]), { fs, log });
				} catch (err) {
					if (file.startupFailure) log.error(`${file.startupFailure}: ${err.message}`);
					failure ??= err;
				}
			}
			if (failure) throw failure;
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
