import { accessSync, constants, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { testConnection } from "../lib/crowdsec/connection-test.js";
import { applyCrowdsecFiles, bouncerLoaded } from "../lib/crowdsec/files.js";
import { importCrowdsecFile, recoverCrowdsecFromWrittenFile } from "../lib/crowdsec/import.js";
import {
	applyCrowdsecUpdate,
	appsecKeyMissing,
	CROWDSEC_FIELDS,
	changedCrowdsecKeys,
	isValidValue,
	requiredFiles,
	validateCrowdsec,
} from "../lib/crowdsec/settings.js";
import { renderStartupBlock, startupWarnings } from "../lib/crowdsec/startup-block.js";
import { effectiveCrowdsec, getCrowdsecConfig, hasStoredCrowdsec, saveStoredCrowdsec } from "../lib/crowdsec/store.js";
import { tlsFileParses, unusableStartFiles } from "../lib/crowdsec/tls-files.js";
import { lockedByOf } from "../lib/environment-info.js";
import errs from "../lib/error.js";
import { rooted } from "../lib/paths.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { global as logger } from "../logger.js";
import internalAuditLog from "./audit-log.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";

const TEST_TIMEOUT_MS = 5000;
const PREVIEW_MAX = 1024 * 1024;
const PAGES = { ban: "ban_template_path", captcha: "captcha_template_path" };
const FIELD_OF_KEY = new Map(CROWDSEC_FIELDS.map((field) => [field.key, field]));

// Filled in at startup: the monitoring reader's last poll (status line), and a poll right after a save
const hooks = { result: () => null, onApplied: async () => {} };

/**
 * Replaces the given hooks, unknown names are ignored
 *
 * @param {{ result?: Function, onApplied?: Function }} next
 */
const setCrowdsecHooks = (next) => {
	for (const name of Object.keys(hooks)) {
		if (typeof next?.[name] === "function") hooks[name] = next[name];
	}
};

const fileExists = (file) => existsSync(rooted(file));
const fileReadable = (file) => {
	try {
		accessSync(rooted(file), constants.R_OK);
		return true;
	} catch {
		return false;
	}
};
const encrypt = (plain) => defaultSecretBox.encrypt(plain);
const FILE_CHECKS = { exists: fileExists, readable: fileReadable, parses: tlsFileParses };

const statusOf = async () => {
	const last = hooks.result();
	return {
		loaded: await bouncerLoaded(),
		reachable: Boolean(last?.reachable),
		last_contact: last?.fetched_at ?? null,
		error: last?.error ?? null,
	};
};

// the GET answer: the values without the two secrets, whether each is set, the locks and the status line
const viewOf = async (cfg) => {
	const { api_key: apiKey, captcha_secret_key: captchaSecret, ...values } = cfg.values;
	return {
		...values,
		api_key_set: apiKey !== "" || cfg.failed.includes("api_key"),
		captcha_secret_set: captchaSecret !== "" || cfg.failed.includes("captcha_secret_key"),
		locked: cfg.locked,
		locked_by: lockedByOf("crowdsec", cfg.locked),
		secret_error: cfg.secretError,
		status: await statusOf(),
	};
};

/**
 * Inside the runtime queue: plan() reads the row and works out the new settings (so a save that committed meanwhile is
 * not lost), then the files of the new values, nginx -t, the row, the reload; a failed test or reload puts the files
 * and that row back.
 *
 * @param   {Function} plan  async () => { before, next, after }
 * @returns {Promise<{ before: Object, next: Object, after: Object }>}
 */
const applyCrowdsec = (plan) =>
	runtimeExclusive(async () => {
		const planned = await plan();
		await applyCrowdsecFiles(planned.after.values, async () => {
			try {
				await internalNginx.test();
			} catch (err) {
				throw new errs.ValidationError(err.message || "nginx config test failed", undefined, { cause: err });
			}
			await saveStoredCrowdsec(planned.next);
			try {
				await internalNginx.reload();
			} catch (err) {
				try {
					await saveStoredCrowdsec(planned.before.stored);
				} catch (restoreErr) {
					logger.error(
						`CrowdSec: the settings could not be put back after the failed reload: ${restoreErr.message}`,
					);
				}
				throw new errs.ValidationError(err.message || "nginx reload failed", undefined, { cause: err });
			}
		});
		return planned;
	});

// the pages the bouncer reads (ban, captcha): a missing one is only a warning, the bouncer runs without it
const missingPagesOf = (values) =>
	values.enabled ? requiredFiles({ ...values, use_tls_auth: false }).filter((file) => !fileReadable(file)) : [];

/**
 * The start gate, shared by the start and a restore: the files the bouncer cannot start without (unusableStartFiles),
 * and an AppSec URL without an API key (appsecKeyMissing); while either applies the include leaves the bouncer off and
 * the row stays as it is.
 *
 * @param   {Object} values
 * @param   {Object} log
 * @returns {{ missingFiles: string[], appsecNoKey: boolean, bouncerOff: boolean }}
 */
const startGate = (values, log) => {
	const missingFiles = unusableStartFiles(values);
	if (missingFiles.length > 0) {
		log.warn(
			`CrowdSec: ${missingFiles.join(", ")} is not set, missing, unreadable or not valid PEM, the bouncer stays off`,
		);
	}
	const appsecNoKey = appsecKeyMissing(values);
	if (appsecNoKey) {
		log.warn(
			"CrowdSec: AppSec has no API key, the bouncer stays off until the key is entered in Settings, CrowdSec",
		);
	}
	return { missingFiles, appsecNoKey, bouncerOff: missingFiles.length > 0 || appsecNoKey };
};

/**
 * At every start: the one-time import, then crowdsec.conf and the two includes written from the row and checked with
 * nginx -t (the reload at the end of prepareApp loads them). A failed nginx -t puts the previous files back (the
 * bouncer stays as nginx loaded it) and is returned for the startup block. Never throws.
 *
 * @param   {Object} [deps]
 * @param   {Object} [deps.nginx]  { test }
 * @param   {Object} [deps.log]
 * @returns {Promise<{ values: Object, locked: string[], nginxError: string|null, missingFiles: string[],
 *          appsecNoKey: boolean, missingPages: string[] } | null>}  null when the row could not be read; missingFiles:
 *          the files that keep the bouncer off, appsecNoKey: an AppSec URL without a key keeps it off, missingPages:
 *          the pages it runs without
 */
const startCrowdsec = async ({ nginx = internalNginx, log = logger } = {}) => {
	try {
		if (!(await hasStoredCrowdsec())) await importCrowdsecFile({ log });
		const cfg = await getCrowdsecConfig();
		if (cfg.invalid.length > 0) log.warn(`CrowdSec: ignored invalid values of ${cfg.invalid.join(", ")}`);
		if (cfg.secretError)
			log.warn("CrowdSec: a saved key cannot be decrypted, enter it again in Settings, CrowdSec");
		// the bouncer parses its TLS client files when nginx starts, which nginx -t does not do: one it cannot parse
		// would stop nginx
		const { missingFiles, appsecNoKey, bouncerOff } = startGate(cfg.values, log);
		const missingPages = missingPagesOf(cfg.values);
		let nginxError = null;
		try {
			await runtimeExclusive(() => applyCrowdsecFiles(cfg.values, () => nginx.test(), { bouncerOff }));
		} catch (err) {
			nginxError = err.message;
			log.error(`CrowdSec: the settings did not pass nginx -t and were not applied: ${err.message}`);
		}
		return { values: cfg.values, locked: cfg.locked, nginxError, missingFiles, appsecNoKey, missingPages };
	} catch (err) {
		log.error(`Could not apply the CrowdSec settings at startup: ${err.message}`);
		return null;
	}
};

const STARTUP_TEST_MS = 2000;
const LOCAL_CONF = "/data/crowdsec/crowdsec.conf.local";

/**
 * Prints the CrowdSec block of the startup log; the connection checks have short timeouts and startup does not wait
 * for this (prepareApp does not await it). Never throws.
 *
 * @param   {Object|null} start   startCrowdsec's result
 * @param   {Object}      [deps]
 * @param   {Function}    [deps.print]
 * @param   {number}      [deps.timeoutMs]
 * @param   {Function}    [deps.test]
 * @returns {Promise<void>}
 */
const logCrowdsecBlock = async (
	start,
	{ print = (text) => console.log(text), timeoutMs = STARTUP_TEST_MS, test = testConnection } = {},
) => {
	if (!start) return;
	try {
		const { values, locked, nginxError, missingFiles = [], appsecNoKey = false, missingPages = [] } = start;
		const bouncerOff = missingFiles.length > 0 || appsecNoKey;
		const active = values.enabled && !nginxError && !bouncerOff;
		const checks = active ? (await test(values, { timeoutMs })).checks : [];
		const warnings = startupWarnings({
			values,
			checks,
			nginxError,
			missingFiles,
			missingPages,
			localOverride: fileExists(LOCAL_CONF),
		});
		print(renderStartupBlock({ values, lockedBy: lockedByOf("crowdsec", locked), checks, warnings, bouncerOff }));
	} catch (err) {
		logger.warn(`CrowdSec: the startup check failed: ${err.message}`);
	}
};

const internalCrowdsecSetting = {
	/**
	 * @param   {Access}  access
	 * @returns {Promise<Object>}
	 */
	get: async (access) => {
		access.canAdmin();
		return await viewOf(await getCrowdsecConfig());
	},

	/**
	 * Validates, runs the connection test while the bouncer is on (unless force), then in the runtime queue reads the
	 * row again, applies the changes to it, validates again, writes the files, tests nginx, saves the row and reloads;
	 * any failure from nginx on puts the files and the row back.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  body  validated against the PUT schema
	 * @returns {Promise<Object>}  the same as get()
	 */
	update: async (access, body) => {
		access.canAdmin();
		const { force = false, ...changes } = body ?? {};
		// the schema checks the form of each value; what only the rules know (a path with "..") is refused here, as a
		// stored value the rules refuse would silently fall back to its default
		const refused = Object.keys(changes).filter(
			(key) =>
				FIELD_OF_KEY.has(key) && changes[key] !== null && !isValidValue(FIELD_OF_KEY.get(key), changes[key]),
		);
		if (refused.length > 0) throw new errs.ValidationError(`Invalid value of ${refused.join(", ")}.`);
		// read again inside the runtime queue, so two saves that overlap both keep their changes
		const plan = async () => {
			const before = await getCrowdsecConfig();
			const next = applyCrowdsecUpdate(before.stored, changes, before.locked, encrypt);
			const after = effectiveCrowdsec(next);
			const problems = validateCrowdsec(after.values, FILE_CHECKS);
			if (problems.length > 0) throw new errs.ValidationError(problems.join(" "));
			return { before, next, after };
		};
		// the connection test (up to 5 s) runs before the queue, so it does not hold the other runtime changes
		const tested = await plan();
		const values = tested.after.values;
		// AppSec answers 401 to a wrong key and with "deny" every request is refused, the admin UI included: saving
		// that is never allowed, not even forced
		const lockoutRisk =
			values.appsec_url !== "" && values.appsec_failure_action === "deny" && !values.admin_ui_excluded;
		if (values.enabled && (!force || lockoutRisk)) {
			const result = await testConnection(values, { timeoutMs: TEST_TIMEOUT_MS });
			const blocked = lockoutRisk && result.checks.some((item) => item.name === "appsec" && item.result !== "ok");
			if (blocked || (!result.ok && !force)) {
				throw new errs.ConnectionTestError(result.checks, undefined, blocked ? "appsec_deny_admin" : undefined);
			}
		}
		const { before, after } = await applyCrowdsec(plan);
		await internalAuditLog.add(access, {
			action: "updated",
			object_type: "setting",
			meta: {
				id: "crowdsec",
				changed: changedCrowdsecKeys(before.values, after.values, changes, before.locked),
				...(force ? { forced: true } : {}),
			},
		});
		void Promise.resolve()
			.then(() => hooks.onApplied())
			.catch((err) => logger.warn(`CrowdSec: the poll after the save failed: ${err.message}`));
		return await internalCrowdsecSetting.get(access);
	},

	/**
	 * The connection test with the submitted (unsaved) values; a secret left empty uses the saved one. Never throws
	 * the upstream status of a bad key: testConnection maps every failure to a check.
	 *
	 * @param   {Access}  access
	 * @param   {Object}  body  validated against the test schema
	 * @returns {Promise<{ ok: boolean, checks: Object[] }>}
	 */
	test: async (access, body) => {
		access.canAdmin();
		const { force: _force, ...changes } = body ?? {};
		const before = await getCrowdsecConfig();
		const { values } = effectiveCrowdsec(applyCrowdsecUpdate(before.stored, changes, before.locked, encrypt));
		return await testConnection(values, { timeoutMs: TEST_TIMEOUT_MS });
	},

	/**
	 * The configured ban or captcha page as it is on disk (at most 1 MiB)
	 *
	 * @param   {Access}  access
	 * @param   {"ban"|"captcha"} page
	 * @returns {Promise<string>}
	 */
	preview: async (access, page) => {
		access.canAdmin();
		const { values } = await getCrowdsecConfig();
		const file = Object.hasOwn(PAGES, page) ? values[PAGES[page]] : "";
		if (!file) throw new errs.ItemNotFoundError(page);
		try {
			return (await readFile(rooted(file), "utf8")).slice(0, PREVIEW_MAX);
		} catch (err) {
			if (err.code === "ENOENT") throw new errs.ItemNotFoundError(file);
			throw err;
		}
	},
};

/**
 * After a restore or merge of the CrowdSec row or files: without a restored row the current settings are read back
 * from the file NPMpro wrote (never replaced by the defaults), otherwise an older backup's crowdsec.conf is imported
 * into the row. Then the three files are written from the row, through the start gate of startCrowdsec. The restore
 * runs nginx -t and the reload afterwards (applyRestored); this runs inside its queue job, so it does not queue itself.
 *
 * @returns {Promise<void>}
 */
const reloadCrowdsecAfterRestore = async () => {
	if (!(await hasStoredCrowdsec()) && (await recoverCrowdsecFromWrittenFile())) {
		logger.info("CrowdSec: the settings of this instance were kept through the restore");
	} else {
		await importCrowdsecFile();
	}
	const cfg = await getCrowdsecConfig();
	// the TLS client files are in no backup, and a backup without secrets has no API key: restoring TLS auth onto an
	// instance without the files, or an AppSec URL without a key, keeps the bouncer off
	await applyCrowdsecFiles(cfg.values, undefined, { bouncerOff: startGate(cfg.values, logger).bouncerOff });
	void Promise.resolve()
		.then(() => hooks.onApplied())
		.catch((err) => logger.warn(`CrowdSec: the poll after the restore failed: ${err.message}`));
};

export { logCrowdsecBlock, reloadCrowdsecAfterRestore, setCrowdsecHooks, startCrowdsec };
export default internalCrowdsecSetting;
