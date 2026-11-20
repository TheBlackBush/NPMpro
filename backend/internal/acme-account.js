import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import dayjs from "dayjs";
import { fetch } from "undici";
import { dispatcherFor, readAcmeDirectory, unreachableReason } from "../lib/acme-directory.js";
import {
	ACME_PRESETS,
	acmeEnvSet,
	isDirectoryUrl,
	isTrustedServer,
	isZeroSsl,
	LETSENCRYPT_SERVER,
	resolveAcmeServer,
	serverKey,
	setStoredAcmeServer,
	storedAcmeServer,
} from "../lib/acme-server.js";
import { runCertbot } from "../lib/certbot.js";
import {
	accountConfigText,
	accountDirsOf,
	accountExists,
	listAccountIds,
	listRenewalConfs,
	registerArgs,
	serverFolders,
	serverOfFolder,
	setRenewalParams,
	updateEmailArgs,
	writeFileAtomic,
} from "../lib/certbot-account.js";
import { CERTBOT_INI, CERTBOT_INI_BASE, renewalOptionEdits } from "../lib/certbot-ini.js";
import errs from "../lib/error.js";
import { rooted } from "../lib/paths.js";
import { withFiles, writeStartupSettings } from "../lib/runtime-apply.js";
import { getRuntimeConfig, invalidate } from "../lib/runtime-config.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { ssl as logger } from "../logger.js";
import acmeAccountModel from "../models/acme_account.js";
import now from "../models/now_helper.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import { pickEditable } from "./monitoring-update.js";
import internalRuntimeSetting, { reapplyRuntimeGroup } from "./runtime-setting.js";

// The ACME accounts: NPMpro's record per CA (npmpro_acme_account) next to certbot's account folders. Every
// registration, email update and replace of a CA runs under that CA's lock; nothing here runs at the start but file
// checks (syncAccountsWithFiles), so the start never waits on a CA.

const RUN_TIMEOUT = 60_000;
const ZEROSSL_TIMEOUT = 10_000;
const MAX_MESSAGE = 2000;
const RUN_DIR = rooted("/tmp");
const RUN_PREFIX = "acme-register-";
const ZEROSSL_EAB_URL = "https://api.zerossl.com/acme/eab-credentials-email";

const locks = new Map();

/**
 * Runs fn after every earlier fn of the same CA has settled
 *
 * @param   {string}    server
 * @param   {Function}  fn
 * @returns {Promise}   fn's result
 */
const withAccountLock = (server, fn) => {
	const key = serverKey(server);
	const run = (locks.get(key) ?? Promise.resolve()).then(fn);
	const tail = run.catch(() => {});
	locks.set(key, tail);
	tail.then(() => {
		if (locks.get(key) === tail) locks.delete(key);
	});
	return run;
};

/** @returns {Promise<string|null>}  the stored instance CA, null for Let's Encrypt */
const readAcmeSetting = async () => (await settingModel.query().where("id", "acme").first())?.meta?.server ?? null;

/** @param {string|null} server  null: Let's Encrypt */
const saveAcmeSetting = async (server) => {
	const meta = { server };
	const existing = await settingModel.query().where("id", "acme").first();
	if (existing) await settingModel.query().where("id", "acme").patch({ meta });
	else
		await settingModel
			.query()
			.insert({ id: "acme", name: "ACME", description: "The instance CA", value: "acme", meta });
};

const loadAcmeServer = async () => setStoredAcmeServer(await readAcmeSetting());

/** @returns {string}  the instance CA (a user-set ACME_SERVER, the stored one, Let's Encrypt) */
const instanceServer = () => resolveAcmeServer(process.env);

const accountRow = (server) => acmeAccountModel.query().where("server", server).first();

/** The API form of a row: no EAB value, only whether one is stored */
const accountView = (row) => ({
	id: row.id,
	server: row.server,
	email: row.email ?? "",
	eab_kid_set: Boolean(row.eab_kid),
	eab_hmac_key_set: Boolean(row.eab_hmac_key),
	state: row.state,
	error: row.error ?? null,
	registered_on: row.registered_on ?? null,
	// the time of the last change: shown with a failure ("Registration failed on ...")
	modified_on: row.modified_on ?? null,
});

const seal = (value) => (value ? defaultSecretBox.encrypt({ value }) : null);

const open = (sealed) => {
	if (!sealed) return null;
	try {
		return defaultSecretBox.decrypt(sealed).value;
	} catch (err) {
		logger.warn(`A stored EAB value of an ACME account cannot be decrypted: ${err.message}`);
		return null;
	}
};

const hideAll = (text, secret) => {
	const needle = secret.toLowerCase();
	let out = "";
	let from = 0;
	for (let at = text.toLowerCase().indexOf(needle); at !== -1; at = text.toLowerCase().indexOf(needle, from)) {
		out += `${text.slice(from, at)}[hidden]`;
		from = at + needle.length;
	}
	return out + text.slice(from);
};

/**
 * A CA's or certbot's message without the given secrets (the email, the EAB pair), in any letter case and also in
 * their URL-encoded form, at most 2000 characters
 */
const scrub = (message, secrets) => {
	let text = String(message ?? "").slice(0, MAX_MESSAGE);
	for (const secret of secrets.filter(Boolean)) {
		for (const form of new Set([secret, encodeURIComponent(secret)])) text = hideAll(text, form);
	}
	return text.trim() || "certbot failed without a message";
};

const baseIni = async () => {
	try {
		return await readFile(CERTBOT_INI, "utf8");
	} catch {
		return CERTBOT_INI_BASE;
	}
};

/** The CA's directory: guarded unless it is the operator's ACME_SERVER, TLS verified unless the setting says no */
const readDirectory = async (server, { fresh = false } = {}) =>
	readAcmeDirectory(server, {
		verify: (await getRuntimeConfig("certificates")).values.server_tls_verify !== false,
		guarded: !isTrustedServer(server, process.env),
		fresh,
	});

const envPair = () => {
	const set = acmeEnvSet(process.env);
	return set.has("ACME_EAB_KID") && set.has("ACME_EAB_HMAC_KEY")
		? { kid: process.env.ACME_EAB_KID, hmac: process.env.ACME_EAB_HMAC_KEY }
		: null;
};

/**
 * What a registration of server uses: on the instance CA the env email and EAB pair when set (D5), else the row's
 *
 * @returns {{email: string|null, eab: {kid: string, hmac: string}|null}}
 */
const registrationValues = (server, row) => {
	const instance = server === instanceServer();
	const email = instance && acmeEnvSet(process.env).has("ACME_EMAIL") ? process.env.ACME_EMAIL : (row?.email ?? null);
	const stored = { kid: open(row?.eab_kid), hmac: open(row?.eab_hmac_key) };
	const eab = (instance && envPair()) || (stored.kid && stored.hmac ? stored : null);
	return { email, eab };
};

const zeroSslEab = async (email) => {
	let body = null;
	try {
		const res = await fetch(ZEROSSL_EAB_URL, {
			method: "POST",
			body: new URLSearchParams({ email }),
			signal: AbortSignal.timeout(ZEROSSL_TIMEOUT),
			dispatcher: dispatcherFor({ guarded: true, verify: true }),
		});
		body = await res.json();
	} catch {
		body = null;
	}
	if (body?.success !== true || typeof body.eab_kid !== "string" || typeof body.eab_hmac_key !== "string") {
		throw new errs.ValidationError("ZeroSSL did not return EAB credentials for this email", "error.acme-zerossl");
	}
	return { kid: body.eab_kid, hmac: body.eab_hmac_key };
};

/**
 * One certbot run in a private folder (mode 0700) holding its config, logs and work folders. The folder, and with it
 * the config that carries the email and the EAB pair, is removed afterwards, also when the run fails.
 *
 * @param   {Function}  fn  (runDir) => result
 */
const inRunFolder = async (fn) => {
	await mkdir(RUN_DIR, { recursive: true });
	const run = await mkdtemp(path.join(RUN_DIR, RUN_PREFIX));
	try {
		return await fn(run);
	} finally {
		await rm(run, { recursive: true, force: true });
	}
};

/** Writes the run's certbot.ini (mode 0600): the one place the email and the EAB pair are written to */
const writeRunConfig = async (run, values) => {
	const file = path.join(run, "certbot.ini");
	const text = accountConfigText(await baseIni(), {
		logsDir: path.join(run, "logs"),
		workDir: path.join(run, "work"),
		...values,
	});
	await writeFile(file, text, { mode: 0o600 });
	return file;
};

const refused = (err, secrets) => {
	const message = scrub(err.message, secrets);
	return new errs.ValidationError(message, "error.acme-refused", { values: { message } });
};

/**
 * Registers an account for server with certbot. Stores nothing: the caller decides what an outcome changes.
 *
 * @param   {string}  server
 * @param   {{email: string|null, eab: {kid: string, hmac: string}|null}}  values
 * @param   {Object}  [options]
 * @param   {boolean} [options.blockedIsUnreachable]  a stored CA the guard now blocks counts as not reachable (rule 2)
 * @returns {Promise<{outcome: "registered", accountId: string}|{outcome: "unreachable", message: string}>}
 */
const attemptRegistration = async (server, { email, eab }, { blockedIsUnreachable = false } = {}) => {
	let directory;
	try {
		directory = await readDirectory(server, { fresh: true });
	} catch (err) {
		if (blockedIsUnreachable && err.message_i18n === "error.acme-blocked") {
			return { outcome: "unreachable", message: err.message };
		}
		throw err;
	}
	if (!directory.reachable) {
		logger.info(`The ACME server ${server} cannot be reached: ${directory.error}`);
		return {
			outcome: "unreachable",
			message: `The ACME server ${server} cannot be reached (${unreachableReason(directory.error)})`,
		};
	}
	if (!directory.directory) {
		throw new errs.ValidationError(`${server} is not an ACME directory`, "error.acme-not-directory", {
			values: { server },
		});
	}
	let pair = eab;
	if (directory.external_account_required && !pair) {
		if (isZeroSsl(server) && email) pair = await zeroSslEab(email);
		else {
			throw new errs.ValidationError(
				`${server} needs an EAB key ID and HMAC key: set up its account in Settings, Certificates`,
				"error.acme-set-up",
				{ values: { server } },
			);
		}
	}
	return inRunFolder(async (run) => {
		const config = await writeRunConfig(run, { email: email || undefined, eab: pair || undefined });
		const before = new Set((await listAccountIds(server)).map((entry) => entry.id));
		try {
			await runCertbot(registerArgs(config, server, { withEmail: Boolean(email) }), { timeout: RUN_TIMEOUT });
		} catch (err) {
			throw refused(err, [email, pair?.kid, pair?.hmac]);
		}
		const created = (await listAccountIds(server)).find((entry) => !before.has(entry.id));
		if (!created) {
			throw new errs.ValidationError("certbot registered no account", "error.acme-refused", {
				values: { message: "certbot registered no account" },
			});
		}
		return { outcome: "registered", accountId: created.id };
	});
};

const audit = (access, action, row, meta = {}) =>
	internalAuditLog.add(access, {
		action,
		object_type: "acme-account",
		object_id: row?.id ?? 0,
		meta: { server: row?.server, ...meta },
	});

const upsertRow = (server, row, patch) =>
	row
		? acmeAccountModel.query().patchAndFetchById(row.id, patch)
		: acmeAccountModel.query().insertAndFetch({ server, ...patch });

/** A registered account: the EAB pair is no longer needed (D7), the email is what the CA now has */
const storeRegistered = async (server, row, { email, accountId, access }) => {
	const saved = await upsertRow(server, row, {
		account_id: accountId,
		email: email || null,
		eab_kid: null,
		eab_hmac_key: null,
		state: "registered",
		error: null,
		registered_on: now(),
	});
	await audit(access, "registered", saved);
	return saved;
};

/**
 * The account id of server, registering it first when it has none (or its folder is gone). A lazy registration's
 * outcome is stored: pending (not reachable) or failed (refused), both refuse the caller's request.
 *
 * @param   {string}  server
 * @param   {Object}  [options]
 * @param   {Access}  [options.access]  whose request caused it; none: the system (the renewal timer)
 * @returns {Promise<string>}
 */
const ensureAccount = (server, { access = null } = {}) =>
	withAccountLock(server, async () => {
		const row = await accountRow(server);
		if (row?.state === "registered" && (await accountExists(server, row.account_id))) return row.account_id;
		const values = registrationValues(server, row);
		let result;
		try {
			result = await attemptRegistration(server, values);
		} catch (err) {
			const saved = await upsertRow(server, row, { state: "failed", error: err.message });
			await audit(access, "registration-failed", saved, { error: err.message });
			throw err;
		}
		if (result.outcome === "unreachable") {
			await upsertRow(server, row, { state: "pending", error: result.message });
			throw new errs.ValidationError(result.message, "error.acme-unreachable", { values: { server } });
		}
		return (await storeRegistered(server, row, { email: values.email, accountId: result.accountId, access }))
			.account_id;
	});

/**
 * Before certbot renews: each renewal conf (all, or those of ids) names an account that exists, its CA's registered
 * one (registered lazily, D4). A conf whose CA has no usable account is reported and left as it is: certbot then fails
 * that certificate only.
 *
 * @param   {number[]|null}  ids
 * @param   {Object}         [options]
 * @param   {Access}         [options.access]
 * @param   {boolean}        [options.strict]  throw the first problem (a manual renew)
 * @returns {Promise<{certificateId: number, server: string, message: string}[]>}
 */
const prepareRenewals = async (ids, { access = null, strict = false } = {}) => {
	const problems = [];
	for (const conf of await listRenewalConfs()) {
		if (ids && !ids.includes(conf.certificateId)) continue;
		if (!conf.server || (await accountExists(conf.server, conf.account))) continue;
		try {
			const accountId = await ensureAccount(conf.server, { access });
			await writeFileAtomic(conf.path, setRenewalParams(conf.text, { account: accountId }));
		} catch (err) {
			if (strict) throw err;
			problems.push({ certificateId: conf.certificateId, server: conf.server, message: err.message });
			logger.warn(
				`Certificate #${conf.certificateId} has no usable ACME account on ${conf.server}: ${err.message}`,
			);
		}
	}
	return problems;
};

/**
 * Changes the contact of a registered account at its CA (fact 3); "" removes every contact. Refused while the CA
 * cannot be reached (D13). The caller holds the CA's lock.
 */
const updateEmailLocked = async (server, email, { access = null } = {}) => {
	const row = await accountRow(server);
	if (!(row?.state === "registered" && (await accountExists(server, row.account_id)))) {
		throw new errs.ValidationError("The ACME account is not registered", "error.acme-not-registered");
	}
	const directory = await readDirectory(server, { fresh: true });
	if (!directory.reachable) {
		throw new errs.ValidationError(
			`The ACME server ${server} cannot be reached: the email can only change while it answers`,
			"error.acme-email-offline",
			{ values: { server } },
		);
	}
	await inRunFolder(async (run) => {
		const config = await writeRunConfig(run, { email: email || undefined });
		try {
			await runCertbot(updateEmailArgs(config, server, row.account_id, { withEmail: Boolean(email) }), {
				timeout: RUN_TIMEOUT,
			});
		} catch (err) {
			throw refused(err, [email]);
		}
	});
	const saved = await acmeAccountModel.query().patchAndFetchById(row.id, { email: email || null, error: null });
	await audit(access, "email-updated", saved);
	return saved;
};

const updateEmail = (server, email, options) =>
	withAccountLock(server, () => updateEmailLocked(server, email, options));

const sqlTime = (ms) => dayjs(ms).format("YYYY-MM-DD HH:mm:ss");

// certbot's LE_REUSE_SERVERS: the v01 directories are the same CA as their v02 ones
const LE_V01 = {
	"https://acme-v01.api.letsencrypt.org/directory": "https://acme-v02.api.letsencrypt.org/directory",
	"https://acme-staging.api.letsencrypt.org/directory": "https://acme-staging-v02.api.letsencrypt.org/directory",
};

/** One spelling per CA: no trailing slash, the v02 Let's Encrypt URLs */
const canonicalServer = (server) => {
	const key = serverKey(server);
	return LE_V01[key] ?? key;
};

/** The canonical servers the rows, files and settings name: the instance CA, every row, every conf, every folder */
const knownServers = (rows, confs, folders) => {
	const servers = new Set(
		[instanceServer(), ...rows.map((row) => row.server), ...confs.map((conf) => conf.server).filter(Boolean)].map(
			canonicalServer,
		),
	);
	const covered = new Set([...servers].flatMap((server) => accountDirsOf(server, "")));
	for (const rel of folders) if (!covered.has(rel)) servers.add(canonicalServer(serverOfFolder(rel)));
	return servers;
};

const rowOf = async (server) => {
	const wanted = canonicalServer(server);
	return (await acmeAccountModel.query()).find((row) => canonicalServer(row.server) === wanted);
};

/**
 * At the start only (nothing runs yet): removes the per-run folders a crash left in the run folder, since they may
 * hold the email or the EAB pair
 */
const sweepRunFolders = async () => {
	let entries;
	try {
		entries = await readdir(RUN_DIR, { withFileTypes: true });
	} catch (err) {
		if (err.code === "ENOENT") return;
		throw err;
	}
	for (const entry of entries) {
		if (entry.isDirectory() && entry.name.startsWith(RUN_PREFIX)) {
			await rm(path.join(RUN_DIR, entry.name), { recursive: true, force: true });
		}
	}
};

/**
 * The start (and a restore or merge): a row for an account folder whose CA has no registered row (the account most
 * confs of the CA name, then the oldest; the email is ACME_EMAIL for the instance CA, else not recorded), registered
 * rows whose folder is gone back to pending, confs naming a missing account pointed at their CA's registered account.
 * File checks only: no network, no certbot.
 */
const syncAccountsWithFiles = async () => {
	const confs = await listRenewalConfs();
	const instance = canonicalServer(instanceServer());
	for (const server of knownServers(await acmeAccountModel.query(), confs, await serverFolders())) {
		// under the CA's lock, so a registration running (after a restore or merge) is not overwritten
		await withAccountLock(server, async () => {
			const row = await rowOf(server);
			const accounts = await listAccountIds(server);
			if (row?.state !== "registered" && accounts.length > 0) {
				const named = (id) =>
					confs.filter(
						(conf) => conf.server && canonicalServer(conf.server) === server && conf.account === id,
					).length;
				// a stable sort keeps the oldest first among accounts named equally often
				const chosen = accounts.toSorted((a, b) => named(b.id) - named(a.id))[0];
				const email =
					row?.email ??
					(server === instance && acmeEnvSet(process.env).has("ACME_EMAIL") ? process.env.ACME_EMAIL : null);
				await upsertRow(server, row, {
					email,
					account_id: chosen.id,
					// the account exists: no EAB pair is kept (D7)
					eab_kid: null,
					eab_hmac_key: null,
					state: "registered",
					error: null,
					registered_on: chosen.created === null ? now() : sqlTime(chosen.created),
				});
				logger.info(`Adopted the ACME account ${chosen.id} of ${server}`);
			} else if (row?.state === "registered" && !accounts.some((entry) => entry.id === row.account_id)) {
				await acmeAccountModel.query().patchAndFetchById(row.id, {
					state: "pending",
					account_id: null,
					error: "The account files are missing: it registers again at the next certificate request",
				});
				logger.warn(`The ACME account files of ${server} are missing, it registers again when needed`);
			}
		});
	}
	for (const conf of confs) {
		if (!conf.server || (await accountExists(conf.server, conf.account))) continue;
		const row = await rowOf(conf.server);
		if (row?.state === "registered" && (await accountExists(row.server, row.account_id))) {
			await writeFileAtomic(conf.path, setRenewalParams(conf.text, { account: row.account_id }));
		}
	}
};

/** After a restore or a merge of certificates or runtime settings: the stored CA, rows and files, envs.sh's line */
const reloadAcmeAfterRestore = async () => {
	await loadAcmeServer();
	await syncAccountsWithFiles();
	await writeStartupSettings();
};

/** In the background after the start: the instance account's contact follows a set ACME_EMAIL */
const syncEnvEmail = async () => {
	if (!acmeEnvSet(process.env).has("ACME_EMAIL")) return;
	const server = instanceServer();
	const row = await accountRow(server);
	if (row?.state !== "registered" || row.email === process.env.ACME_EMAIL) return;
	try {
		await updateEmail(server, process.env.ACME_EMAIL);
		logger.info(`The email of the ACME account of ${server} now follows ACME_EMAIL`);
	} catch (err) {
		await acmeAccountModel.query().patchAndFetchById(row.id, { error: err.message });
		logger.warn(`Could not set the email of the ACME account of ${server} from ACME_EMAIL: ${err.message}`);
	}
};

const ACME_KEYS = ["server", "email", "eab_kid", "eab_hmac_key"];
const LOCK_ENV = {
	server: "ACME_SERVER",
	email: "ACME_EMAIL",
	eab_kid: "ACME_EAB_KID",
	eab_hmac_key: "ACME_EAB_HMAC_KEY",
};
const EMAIL = /^[^\s@]+@[^\s@]+$/u;
const EAB_VALUE = /^\S{1,1024}$/u;
const MAX_EMAIL = 255;

/** The keys an env var locks (D5): its own, and the EAB pair together */
const lockedKeys = (env = process.env) => {
	const set = acmeEnvSet(env);
	const locked = ACME_KEYS.filter((key) => set.has(LOCK_ENV[key]));
	if (locked.includes("eab_kid") !== locked.includes("eab_hmac_key")) {
		return [...new Set([...locked, "eab_kid", "eab_hmac_key"])];
	}
	return locked;
};

const serverSource = () => {
	if (acmeEnvSet(process.env).has("ACME_SERVER")) return "env";
	return storedAcmeServer() ? "setting" : "default";
};

const isRegistered = async (row) => row?.state === "registered" && (await accountExists(row.server, row.account_id));

const refuseValue = (key, message, i18n) => {
	throw new errs.ValidationError(`${key}: ${message}`, i18n);
};

/**
 * GET /settings/acme: the instance CA, its account and every stored account (no EAB value, only whether one is set)
 *
 * @param   {Access}  access
 * @returns {Promise<Object>}
 */
const getSettings = async (access) => {
	access.canAdmin();
	const server = instanceServer();
	const locked = lockedKeys();
	const envSet = acmeEnvSet(process.env);
	const rows = await acmeAccountModel.query().orderBy("server");
	const own = rows.find((row) => row.server === server);
	return {
		server,
		server_source: serverSource(),
		email: locked.includes("email") ? process.env.ACME_EMAIL : (own?.email ?? ""),
		eab_kid_set: envSet.has("ACME_EAB_KID") || Boolean(own?.eab_kid),
		eab_hmac_key_set: envSet.has("ACME_EAB_HMAC_KEY") || Boolean(own?.eab_hmac_key),
		account: own ? accountView(own) : null,
		locked,
		locked_by: Object.fromEntries(locked.map((key) => [key, LOCK_ENV[key]])),
		presets: ACME_PRESETS,
		accounts: rows.map(accountView),
	};
};

/** The instance CA's renewal confs with the instance profile and must-staple (fact 5) */
const syncRenewalOptions = async () => {
	const { values } = await getRuntimeConfig("certificates");
	const edits = await renewalOptionEdits({
		server: instanceServer(),
		profile: values.profile,
		mustStaple: values.must_staple,
	});
	if (edits.length > 0) await withFiles(edits, async () => {}, { log: logger });
};

/** After a CA switch: a profile the new CA lists no more is dropped to none (reachable CA only), never refused */
const dropUnlistedProfile = async (access, server) => {
	const { values, locked } = await getRuntimeConfig("certificates");
	if (!values.profile || locked.includes("profile")) return;
	let result;
	try {
		result = await readDirectory(server);
	} catch {
		return;
	}
	if (result.reachable && result.directory && !Object.hasOwn(result.profiles, values.profile)) {
		logger.warn(`The ACME server ${server} does not offer the profile ${values.profile}: the profile is now none`);
		await internalRuntimeSetting.updateRuntime(access, "certificates", { profile: "" });
	}
};

/**
 * Stores a new instance CA: the setting row, the startup settings for envs.sh, the runtime defaults that follow it
 * (D8: applied now, an OCSP stapling change reloads nginx, no profile check) and the options of its certificates'
 * renewal confs. All or nothing: a failure puts the previous CA back and is rethrown.
 */
const setInstanceServer = async (access, server, prevValues) => {
	const previous = await readAcmeSetting();
	const previousMemory = storedAcmeServer();
	const stored = server === LETSENCRYPT_SERVER ? null : server;
	try {
		await saveAcmeSetting(stored);
		setStoredAcmeServer(stored);
		await writeStartupSettings();
		await reapplyRuntimeGroup("certificates", prevValues);
		await dropUnlistedProfile(access, server);
		await syncRenewalOptions();
	} catch (err) {
		await saveAcmeSetting(previous);
		setStoredAcmeServer(previousMemory);
		invalidate("certificates");
		await writeStartupSettings();
		throw err;
	}
	await internalAuditLog.add(access, { action: "updated", object_type: "setting", meta: { id: "acme", server } });
};

/** The email of a PUT: null removes it; a changed one must look like an address */
const checkedEmail = (changes, row) => {
	const given = "email" in changes;
	const email = given ? changes.email.trim() || null : (row?.email ?? null);
	const changed = given && email !== (row?.email ?? null);
	if (changed && email !== null && !(email.length <= MAX_EMAIL && EMAIL.test(email))) {
		refuseValue("email", "must be an email address", "error.acme-email");
	}
	return { given, email, changed };
};

/** The EAB pair of a PUT: only while the account is not registered (fact 10), both values or none */
const checkedEab = (changes, row, registered) => {
	const kid = changes.eab_kid || open(row?.eab_kid);
	const hmac = changes.eab_hmac_key || open(row?.eab_hmac_key);
	const entered = !registered && Boolean(changes.eab_kid || changes.eab_hmac_key);
	if (entered && !(kid && hmac)) refuseValue("eab", "enter both the key ID and the HMAC key", "error.acme-eab-pair");
	if (entered && !(EAB_VALUE.test(kid) && EAB_VALUE.test(hmac))) {
		refuseValue("eab", "the key ID and the HMAC key cannot hold spaces", "error.acme-eab-pair");
	}
	return { kid, hmac, entered };
};

/**
 * PUT /settings/acme: locked keys are dropped; only changed values are checked (rule 2). A changed CA without an
 * account, or new account values, register now: not reachable stores them as pending with a warning (D4), a refusal
 * stores nothing. An email change of a registered account needs its CA (D13). EAB values only count while the account
 * is not registered (fact 10).
 *
 * @param   {Access}  access
 * @param   {Object}  body  server, email, eab_kid, eab_hmac_key (all optional)
 * @returns {Promise<Object>}  the GET answer, plus warning "unreachable" when the account was stored as pending
 */
const saveSettings = async (access, body) => {
	access.canAdmin();
	const changes = pickEditable(body ?? {}, lockedKeys(), ACME_KEYS);
	const before = instanceServer();
	const target = changes.server ?? before;
	const serverChanged = target !== before;
	if (serverChanged && !isDirectoryUrl(target)) {
		refuseValue("server", "must be an https ACME directory URL", "error.acme-url");
	}
	const prevValues = (await getRuntimeConfig("certificates")).values;
	let warning;
	await withAccountLock(target, async () => {
		const row = await accountRow(target);
		const registered = await isRegistered(row);
		const mail = checkedEmail(changes, row);
		const eab = checkedEab(changes, row, registered);
		// a typed URL passes the guard also when its account exists (D6)
		if (serverChanged && registered) await readDirectory(target);
		if (registered) {
			if (mail.changed) await updateEmailLocked(target, mail.email, { access });
		} else if (serverChanged || mail.changed || eab.entered) {
			const values = registrationValues(target, row);
			if (mail.given) values.email = mail.email;
			if (eab.entered) values.eab = { kid: eab.kid, hmac: eab.hmac };
			const result = await attemptRegistration(target, values, { blockedIsUnreachable: !serverChanged });
			if (result.outcome === "unreachable") {
				warning = "unreachable";
				await upsertRow(target, row, {
					email: mail.email,
					...(eab.entered ? { eab_kid: seal(eab.kid), eab_hmac_key: seal(eab.hmac) } : {}),
					state: "pending",
					error: result.message,
				});
			} else {
				await storeRegistered(target, row, { email: values.email, accountId: result.accountId, access });
			}
		}
		if (serverChanged || mail.changed || eab.entered) {
			await audit(access, "updated", await accountRow(target), {
				server: target,
				email_changed: mail.changed,
				eab_entered: eab.entered,
			});
		}
	});
	if (serverChanged) await setInstanceServer(access, target, prevValues);
	return { ...(await getSettings(access)), ...(warning ? { warning } : {}) };
};

/**
 * POST /settings/acme/register: a pending, failed or missing account registers now
 *
 * @param   {Access}  access
 * @param   {Object}  [options]
 * @param   {string}  [options.server]  default the instance CA
 * @returns {Promise<Object>}  the GET answer, plus warning "unreachable" when the CA still cannot be reached
 */
const registerNow = async (access, { server } = {}) => {
	access.canAdmin();
	const target = server ?? instanceServer();
	if (target !== instanceServer() && !(await accountRow(target))) {
		throw new errs.ValidationError("This CA has no account in Settings", "error.acme-unknown-ca");
	}
	let warning;
	try {
		await ensureAccount(target, { access });
	} catch (err) {
		if (err.message_i18n !== "error.acme-unreachable") throw err;
		warning = "unreachable";
	}
	return { ...(await getSettings(access)), ...(warning ? { warning } : {}) };
};

/**
 * GET /settings/acme/profiles: the CA's profiles (5 minute cache), for the Settings profile list (D9)
 *
 * @param   {Access}  access
 * @param   {Object}  [options]
 * @param   {string}  [options.server]  default the instance CA
 * @returns {Promise<Object>}
 */
const listProfiles = async (access, { server } = {}) => {
	access.canAdmin();
	const target = server ?? instanceServer();
	if (!(isDirectoryUrl(target) || isTrustedServer(target, process.env))) {
		refuseValue("server", "must be an https ACME directory URL", "error.acme-url");
	}
	const result = await readDirectory(target);
	return {
		reachable: result.reachable,
		directory: result.directory,
		external_account_required: result.external_account_required,
		profiles: Object.entries(result.profiles).map(([name, description]) => ({ name, description })),
	};
};

const internalAcmeAccount = { getSettings, listProfiles, registerNow, saveSettings };

export {
	accountRow,
	accountView,
	attemptRegistration,
	audit,
	baseIni,
	ensureAccount,
	getSettings,
	inRunFolder,
	instanceServer,
	listProfiles,
	loadAcmeServer,
	lockedKeys,
	open,
	prepareRenewals,
	readAcmeSetting,
	readDirectory,
	refused,
	registerNow,
	registrationValues,
	reloadAcmeAfterRestore,
	saveAcmeSetting,
	saveSettings,
	scrub,
	seal,
	setInstanceServer,
	storeRegistered,
	sweepRunFolders,
	syncAccountsWithFiles,
	syncEnvEmail,
	syncRenewalOptions,
	updateEmail,
	updateEmailLocked,
	upsertRow,
	withAccountLock,
	writeRunConfig,
};

export default internalAcmeAccount;
