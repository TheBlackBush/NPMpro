import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { testConnection } from "../lib/crowdsec/connection-test.js";
import { applyCrowdsecFiles, bouncerLoaded } from "../lib/crowdsec/files.js";
import { importCrowdsecFile } from "../lib/crowdsec/import.js";
import {
	applyCrowdsecUpdate,
	CROWDSEC_FIELDS,
	changedCrowdsecKeys,
	isValidValue,
	requiredFiles,
	validateCrowdsec,
} from "../lib/crowdsec/settings.js";
import { renderStartupBlock, startupWarnings } from "../lib/crowdsec/startup-block.js";
import { effectiveCrowdsec, getCrowdsecConfig, hasStoredCrowdsec, saveStoredCrowdsec } from "../lib/crowdsec/store.js";
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
const encrypt = (plain) => defaultSecretBox.encrypt(plain);

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

// the files of the new values, nginx -t, the row, the reload; a failed test or reload puts the files and the row back
const applyCrowdsec = (values, { save, restore }) =>
	runtimeExclusive(() =>
		applyCrowdsecFiles(values, async () => {
			try {
				await internalNginx.test();
			} catch (err) {
				throw new errs.ValidationError(err.message || "nginx config test failed", undefined, { cause: err });
			}
			await save();
			try {
				await internalNginx.reload();
			} catch (err) {
				await restore();
				throw new errs.ValidationError(err.message || "nginx reload failed", undefined, { cause: err });
			}
		}),
	);

/**
 * At every start: the one-time import, then crowdsec.conf and the two includes written from the row and checked with
 * nginx -t (the reload at the end of prepareApp loads them). A failed nginx -t puts the previous files back (the
 * bouncer stays as nginx loaded it) and is returned for the startup block. Never throws.
 *
 * @param   {Object} [deps]
 * @param   {Object} [deps.nginx]  { test }
 * @param   {Object} [deps.log]
 * @returns {Promise<{ values: Object, locked: string[], nginxError: string|null } | null>}  null when the row could
 *          not be read
 */
const startCrowdsec = async ({ nginx = internalNginx, log = logger } = {}) => {
	try {
		if (!(await hasStoredCrowdsec())) await importCrowdsecFile({ log });
		const cfg = await getCrowdsecConfig();
		if (cfg.invalid.length > 0) log.warn(`CrowdSec: ignored invalid values of ${cfg.invalid.join(", ")}`);
		if (cfg.secretError)
			log.warn("CrowdSec: a saved key cannot be decrypted, enter it again in Settings, CrowdSec");
		let nginxError = null;
		try {
			await runtimeExclusive(() => applyCrowdsecFiles(cfg.values, () => nginx.test()));
		} catch (err) {
			nginxError = err.message;
			log.error(`CrowdSec: the settings did not pass nginx -t and were not applied: ${err.message}`);
		}
		return { values: cfg.values, locked: cfg.locked, nginxError };
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
		const { values, locked, nginxError } = start;
		const active = values.enabled && !nginxError;
		const checks = active ? (await test(values, { timeoutMs })).checks : [];
		const missingFiles = active ? requiredFiles(values).filter((file) => !fileExists(file)) : [];
		const warnings = startupWarnings({
			values,
			checks,
			nginxError,
			missingFiles,
			localOverride: fileExists(LOCAL_CONF),
		});
		print(renderStartupBlock({ values, lockedBy: lockedByOf("crowdsec", locked), checks, warnings }));
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
	 * Validates, runs the connection test while the bouncer is on (unless force), then writes the files, tests nginx,
	 * saves the row and reloads; any failure from nginx on puts the files and the row back.
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
		const before = await getCrowdsecConfig();
		const next = applyCrowdsecUpdate(before.stored, changes, before.locked, encrypt);
		const after = effectiveCrowdsec(next);
		const problems = validateCrowdsec(after.values, { exists: fileExists });
		if (problems.length > 0) throw new errs.ValidationError(problems.join(" "));
		if (after.values.enabled && !force) {
			const result = await testConnection(after.values, { timeoutMs: TEST_TIMEOUT_MS });
			if (!result.ok) throw new errs.ConnectionTestError(result.checks);
		}
		await applyCrowdsec(after.values, {
			save: () => saveStoredCrowdsec(next),
			restore: () => saveStoredCrowdsec(before.stored),
		});
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

export { logCrowdsecBlock, setCrowdsecHooks, startCrowdsec };
export default internalCrowdsecSetting;
