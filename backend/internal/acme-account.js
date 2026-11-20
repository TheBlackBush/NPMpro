import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import dayjs from "dayjs";
import { readAcmeDirectory, unreachableReason, zeroSslEab } from "../lib/acme-directory.js";
import {
	ACME_PRESETS,
	acmeEnvSet,
	isDirectoryUrl,
	isTrustedServer,
	isZeroSsl,
	LETSENCRYPT_SERVER,
	normalizeServer,
	resolveAcmeServer,
	sameServer,
	serverKey,
	setStoredAcmeServer,
	storedAcmeServer,
} from "../lib/acme-server.js";
import { runCertbot } from "../lib/certbot.js";
import {
	accountConfigText,
	accountDirsOf,
	accountExists,
	CERTBOT_DIR,
	listAccountIds,
	listRenewalConfs,
	readRenewalConf,
	registerArgs,
	renewalConfPath,
	serverFolders,
	serverOfFolder,
	setRenewalParams,
	unregisterArgs,
	updateEmailArgs,
	writeFileAtomic,
} from "../lib/certbot-account.js";
import { CERTBOT_INI, CERTBOT_INI_BASE, renewalOptionEdits } from "../lib/certbot-ini.js";
import { cleanCertbotMessage } from "../lib/certbot-message.js";
import errs from "../lib/error.js";
import { rooted } from "../lib/paths.js";
import { withFiles, writeStartupSettings } from "../lib/runtime-apply.js";
import { getRuntimeConfig, invalidate } from "../lib/runtime-config.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { ssl as logger } from "../logger.js";
import acmeAccountModel from "../models/acme_account.js";
import certificateModel from "../models/certificate.js";
import now from "../models/now_helper.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";
import { pickEditable } from "./monitoring-update.js";
import internalRuntimeSetting, { reapplyRuntimeGroup } from "./runtime-setting.js";

// The ACME accounts: NPMpro's record per CA (npmpro_acme_account) next to certbot's account folders. Every
// registration, email update and replace of a CA runs under that CA's lock; nothing here runs at the start but file
// checks (syncAccountsWithFiles), so the start never waits on a CA.

const RUN_TIMEOUT = 60_000;
const MAX_MESSAGE = 2000;
const RUN_DIR = rooted("/tmp");
const RUN_PREFIX = "acme-register-";
// certbot's answer while another run holds its config-dir lock (the start's renew, a request, the timer)
const LOCK_BUSY = /already running/iu;
// Replace account registers into a folder of this name under the certbot folder (the same filesystem, so the new
// account folder moves by rename); a crash may leave one, the start removes it
const REPLACE_PREFIX = ".replace-";

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

/**
 * Loads the stored instance CA (the start, a restore). A value stored before the scheme and host were lower-cased
 * (normalizeServer) is stored again in that spelling, so the setting, the rows and certbot's folders converge.
 */
const loadAcmeServer = async () => {
	const value = await readAcmeSetting();
	const normal = normalizeServer(value);
	if (normal !== value) await saveAcmeSetting(normal);
	setStoredAcmeServer(normal);
};

/** @returns {string}  the instance CA (a user-set ACME_SERVER, the stored one, Let's Encrypt) */
const instanceServer = () => resolveAcmeServer(process.env);

/** The row of a CA, whatever the spelling of either (serverKey): one row per CA */
const accountRow = async (server) => {
	const wanted = serverKey(server);
	return (await acmeAccountModel.query()).find((row) => serverKey(row.server) === wanted);
};

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
 * @param   {string}   server
 * @param   {Object}   [row]
 * @param   {Object}   [options]
 * @param   {boolean}  [options.asInstance]  server is the instance CA (a Settings save switching to it)
 * @returns {{email: string|null, eab: {kid: string, hmac: string}|null}}
 */
const registrationValues = (server, row, { asInstance = false } = {}) => {
	const instance = asInstance || sameServer(server, instanceServer());
	const email = instance && acmeEnvSet(process.env).has("ACME_EMAIL") ? process.env.ACME_EMAIL : (row?.email ?? null);
	const stored = { kid: open(row?.eab_kid), hmac: open(row?.eab_hmac_key) };
	const eab = (instance && envPair()) || (stored.kid && stored.hmac ? stored : null);
	return { email, eab };
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
	const message = scrub(cleanCertbotMessage(err.message), secrets);
	return new errs.ValidationError(message, "error.acme-refused", { values: { message } });
};

/** A CA needs an EAB pair and none is known: the Settings window names its Change button, a request the Settings card */
const eabMissing = (server, inSettings) =>
	inSettings
		? new errs.ValidationError(
				`${server} needs an EAB key ID and HMAC key: open Change and enter them`,
				"error.acme-set-up",
				{ values: { server } },
			)
		: new errs.ValidationError(
				`${server} needs an EAB key ID and HMAC key: an administrator enters them in Settings, Certificates & TLS, ACME account`,
				"error.acme-set-up-request",
				{ values: { server } },
			);

/** certbot ended well but left no new account folder: shown as a refusal, like any other certbot failure */
const noAccountRegistered = () =>
	new errs.ValidationError("certbot registered no account", "error.acme-refused", {
		values: { message: "certbot registered no account" },
	});

/**
 * A failure of NPMpro's own steps of a Replace account (a folder move, a conf write, the row update), after which
 * everything was put back: not the CA's refusal. The cause is logged, it may name local paths.
 */
const notPutInPlace = (err) => {
	logger.error(`Replace account: the new account could not be put in place: ${err.message}`);
	return new errs.ValidationError(
		"The new account could not be put in place: nothing was changed",
		"error.acme-replace-local",
		{ cause: err },
	);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const busyError = () =>
	new errs.ValidationError(
		"Certbot is already running another task: nothing was changed, try again in a minute",
		"error.acme-busy",
	);

const isBusy = (err) => err?.message_i18n === "error.acme-busy";

// how often a Settings save, Register now or a certificate request retries while certbot is busy (tests: shorter)
let busyRetry = { retries: 3, delayMs: 3000 };

/** @param {{retries: number, delayMs: number}} options */
const setBusyRetry = (options) => {
	busyRetry = { ...options };
};

/**
 * Runs fn again after delayMs while it fails because certbot is busy (isBusy), at most retries more times; then the
 * busy error is thrown
 *
 * @param   {Function}  fn
 * @param   {{retries: number, delayMs: number}}  options
 */
const retryWhileBusy = async (fn, { retries, delayMs }) => {
	for (let attempt = 0; ; attempt += 1) {
		try {
			return await fn();
		} catch (err) {
			if (!(attempt < retries && isBusy(err))) throw err;
			await sleep(delayMs);
		}
	}
};

/**
 * One certbot run of an account action: certbot's lock answer is retried (retryWhileBusy) and then thrown as the busy
 * error, any other failure as the CA's refusal without the secrets
 */
const runAccountCertbot = (args, secrets, retry = busyRetry) =>
	retryWhileBusy(async () => {
		try {
			return await runCertbot(args, { timeout: RUN_TIMEOUT });
		} catch (err) {
			if (LOCK_BUSY.test(String(err.message))) throw busyError();
			throw refused(err, secrets);
		}
	}, retry);

/**
 * Registers an account for server with certbot. Stores nothing: the caller decides what an outcome changes.
 *
 * @param   {string}  server
 * @param   {{email: string|null, eab: {kid: string, hmac: string}|null}}  values
 * @param   {Object}  [options]
 * @param   {boolean} [options.blockedIsUnreachable]  a stored CA the guard now blocks counts as not reachable (rule 2)
 * @param   {boolean} [options.inSettings]  an administrator's action in Settings (else a certificate request or renewal):
 *          a missing EAB pair names the place to enter it accordingly
 * @returns {Promise<{outcome: "registered", accountId: string}|{outcome: "unreachable", message: string}>}
 */
const attemptRegistration = async (
	server,
	{ email, eab },
	{ blockedIsUnreachable = false, inSettings = false } = {},
) => {
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
		else throw eabMissing(server, inSettings);
	}
	return inRunFolder(async (run) => {
		const config = await writeRunConfig(run, { email: email || undefined, eab: pair || undefined });
		const before = new Set((await listAccountIds(server)).map((entry) => entry.id));
		await runAccountCertbot(registerArgs(config, server, { withEmail: Boolean(email) }), [
			email,
			pair?.kid,
			pair?.hmac,
		]);
		const created = (await listAccountIds(server)).find((entry) => !before.has(entry.id));
		if (!created) {
			throw noAccountRegistered();
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

const sqlTime = (ms) => dayjs(ms).format("YYYY-MM-DD HH:mm:ss");

/** The email recorded for an adopted account folder: the row's, else ACME_EMAIL on the instance CA, else unknown */
const adoptedEmail = (server, row) =>
	row?.email ??
	(sameServer(server, instanceServer()) && acmeEnvSet(process.env).has("ACME_EMAIL") ? process.env.ACME_EMAIL : null);

/** Records an account folder certbot has for server as its registered account (no EAB pair is kept, D7) */
const adoptAccount = (server, row, chosen) =>
	upsertRow(server, row, {
		email: adoptedEmail(server, row),
		account_id: chosen.id,
		eab_kid: null,
		eab_hmac_key: null,
		state: "registered",
		error: null,
		registered_on: chosen.created === null ? now() : sqlTime(chosen.created),
	});

/**
 * A row that is not registered while certbot has a usable folder for its CA (a run killed after certbot wrote the
 * account, a restore): the oldest folder becomes the row's account, so certbot is not asked to register again (it
 * refuses an existing account). The caller holds the CA's lock.
 *
 * @returns {Promise<Object|undefined>}  the row, adopted or as it was
 */
const adoptUsableAccount = async (server, row) => {
	if (row?.state === "registered" && (await accountExists(row.server, row.account_id))) return row;
	const [oldest] = await listAccountIds(row?.server ?? server);
	if (!oldest) return row;
	logger.info(`Adopted the ACME account ${oldest.id} of ${server}`);
	return await adoptAccount(server, row, oldest);
};

/**
 * The account of server, registering it first when it has none (or its folder is gone). A lazy registration's
 * outcome is stored: pending (not reachable) or failed (refused), both refuse the caller's request. While certbot is
 * busy with another run nothing is stored.
 *
 * certbot finds an account by the spelling of the URL its folder was made with (accounts/<host><path>, case kept),
 * while NPMpro matches the CA in any spelling (serverKey). So the answer carries the row's spelling, the one of the
 * folder, and every certbot run of the account names that one; a row without a folder registers with it too.
 *
 * @param   {string}  server
 * @param   {Object}  [options]
 * @param   {Access}  [options.access]  whose request caused it; none: the system (the renewal timer)
 * @param   {boolean} [options.inSettings]  Register now or Try again in Settings (else a certificate request or renewal)
 * @returns {Promise<{accountId: string, server: string}>}  the account id and the spelling certbot is given
 */
const ensureAccountLocked = async (server, { access = null, inSettings = false } = {}) => {
	const row = await adoptUsableAccount(server, await accountRow(server));
	const spelling = row?.server ?? server;
	if (row?.state === "registered" && (await accountExists(row.server, row.account_id))) {
		return { accountId: row.account_id, server: spelling };
	}
	const values = registrationValues(server, row);
	let result;
	try {
		result = await attemptRegistration(spelling, values, { inSettings });
	} catch (err) {
		if (isBusy(err)) throw err;
		const saved = await upsertRow(server, row, { state: "failed", error: err.message });
		await audit(access, "registration-failed", saved, { error: err.message });
		throw err;
	}
	if (result.outcome === "unreachable") {
		await upsertRow(server, row, { state: "pending", error: result.message });
		throw new errs.ValidationError(result.message, "error.acme-unreachable", { values: { server } });
	}
	const saved = await storeRegistered(spelling, row, { email: values.email, accountId: result.accountId, access });
	return { accountId: saved.account_id, server: saved.server };
};

/**
 * ensureAccountLocked under the CA's lock (a caller that already holds it calls ensureAccountLocked: the lock is not
 * re-entrant)
 *
 * @returns {Promise<string>}  the account id
 */
const ensureAccount = async (server, options) =>
	(await withAccountLock(server, () => ensureAccountLocked(server, options))).accountId;

/**
 * Before certbot renews a certificate: its renewal conf names an account that exists, its CA's registered one
 * (registered lazily, D4), in the spelling of the account's folder. The caller holds the CA's lock.
 *
 * @param {{path: string, text: string, server: ?string, account: ?string}}  conf
 * @param {Object}  [options]
 * @param {Access}  [options.access]
 */
const prepareRenewalLocked = async (conf, { access = null } = {}) => {
	if (!conf.server || (await accountExists(conf.server, conf.account))) return;
	const { accountId, server } = await ensureAccountLocked(conf.server, { access });
	await writeFileAtomic(conf.path, setRenewalParams(conf.text, { account: accountId, server }));
};

/**
 * Runs fn, a certbot renewal of one certificate, under the lock of the certificate's CA, so a Replace account of that
 * CA waits for it (and it for a Replace account): the renewal then never writes back a conf naming the old account.
 * The conf is made to name a usable account first (prepareRenewalLocked); when its CA has none that is logged and fn
 * still runs, so certbot fails that certificate only, unless strict (a manual renew) throws it.
 *
 * @param   {number}    certificateId
 * @param   {Function}  fn  () => result
 * @param   {Object}    [options]
 * @param   {Access}    [options.access]
 * @param   {boolean}   [options.strict]
 * @returns {Promise<*>}  fn's result
 */
const withRenewalLock = async (certificateId, fn, { access = null, strict = false } = {}) => {
	const file = renewalConfPath(certificateId);
	// a conf without a server renews at certbot's default CA, Let's Encrypt
	const lockServer = (await readRenewalConf(file))?.server ?? LETSENCRYPT_SERVER;
	return await withAccountLock(lockServer, async () => {
		// read again under the lock: a Replace account may have rewritten it meanwhile
		const conf = await readRenewalConf(file);
		if (conf) {
			try {
				await prepareRenewalLocked(conf, { access });
			} catch (err) {
				if (strict) throw err;
				logger.warn(
					`Certificate #${certificateId} has no usable ACME account on ${conf.server}: ${err.message}`,
				);
			}
		}
		return await fn();
	});
};

/**
 * Runs fn while holding the locks of all the given CAs, taken in sorted serverKey order: every other caller holds one
 * lock at a time, so the order rules out a deadlock. fn may not take any of these locks again (they are not
 * re-entrant): it uses the Locked variants.
 *
 * @param   {string[]}  servers
 * @param   {Function}  fn
 * @returns {Promise<*>}  fn's result
 */
const withAccountLocks = (servers, fn) => {
	const keys = [...new Set(servers.map(serverKey))].sort((a, b) => a.localeCompare(b));
	const from = (index) => (index === keys.length ? fn() : withAccountLock(keys[index], () => from(index + 1)));
	return from(0);
};

/**
 * Before certbot renews: each renewal conf names an account that exists (prepareRenewalLocked). A conf whose CA has
 * no usable account is reported and left as it is: certbot then fails that certificate only. The caller holds the
 * locks of the confs' CAs.
 *
 * @param   {Object[]}  confs   from listRenewalConfs
 * @param   {Object}    [options]
 * @param   {Access}    [options.access]
 * @returns {Promise<{certificateId: number, server: string, message: string}[]>}
 */
const prepareRenewals = async (confs, { access = null } = {}) => {
	const problems = [];
	for (const conf of confs) {
		try {
			await prepareRenewalLocked(conf, { access });
		} catch (err) {
			problems.push({ certificateId: conf.certificateId, server: conf.server, message: err.message });
			logger.warn(
				`Certificate #${conf.certificateId} has no usable ACME account on ${conf.server}: ${err.message}`,
			);
		}
	}
	return problems;
};

/**
 * Runs fn, one certbot renewal of all due certificates, while holding the lock of every CA that has an account row or
 * a renewal conf (withAccountLocks): a Replace account of any of them waits for it, and it for a Replace account, so
 * certbot never writes back a conf naming a replaced account. The confs are prepared under the locks first. When the
 * CAs cannot be listed, fn runs without the locks and without the preparation.
 *
 * @param   {Function}  fn
 * @returns {Promise<*>}  fn's result
 */
const withRenewalLocks = async (fn) => {
	let servers;
	try {
		const confs = await listRenewalConfs();
		const rows = await acmeAccountModel.query();
		servers = [...rows.map((row) => row.server), ...confs.map((conf) => conf.server ?? LETSENCRYPT_SERVER)];
	} catch (err) {
		logger.warn(`The ACME accounts and renewal confs could not be listed, renewing without their checks: ${err}`);
		return await fn();
	}
	const held = new Set(servers.map(serverKey));
	return await withAccountLocks(servers, async () => {
		try {
			// read again under the locks: a Replace account may have rewritten a conf meanwhile; a conf of a CA that
			// appeared since is left to certbot as it is (its lock is not held)
			const confs = (await listRenewalConfs()).filter((conf) => conf.server && held.has(serverKey(conf.server)));
			await prepareRenewals(confs);
		} catch (err) {
			logger.warn(`The renewal confs could not be prepared: ${err}`);
		}
		return await fn();
	});
};

/**
 * Changes the contact of a registered account at its CA (fact 3); "" removes every contact. Refused while the CA
 * cannot be reached (D13). The caller holds the CA's lock.
 *
 * @param {string}  server
 * @param {string}  email
 * @param {Object}  [options]
 * @param {Access}  [options.access]
 * @param {{retries: number, delayMs: number}}  [options.retry]  while certbot is busy (default busyRetry)
 */
const updateEmailLocked = async (server, email, { access = null, retry = busyRetry } = {}) => {
	const row = await accountRow(server);
	if (!(row?.state === "registered" && (await accountExists(row.server, row.account_id)))) {
		throw new errs.ValidationError("The ACME account is not registered", "error.acme-not-registered");
	}
	let directory;
	try {
		directory = await readDirectory(server, { fresh: true });
	} catch (err) {
		// the account's CA is kept: a name the guard now blocks counts as not reachable (rule 2)
		if (err.message_i18n !== "error.acme-blocked") throw err;
		directory = { reachable: false };
	}
	if (!directory.reachable) {
		throw new errs.ValidationError(
			`The ACME server ${server} cannot be reached: the email can only change while it answers`,
			"error.acme-email-offline",
			{ values: { server } },
		);
	}
	await inRunFolder(async (run) => {
		const config = await writeRunConfig(run, { email: email || undefined });
		await runAccountCertbot(
			// the spelling of the account's folder (ensureAccountLocked)
			updateEmailArgs(config, row.server, row.account_id, { withEmail: Boolean(email) }),
			[email],
			retry,
		);
	});
	const saved = await acmeAccountModel.query().patchAndFetchById(row.id, { email: email || null, error: null });
	await audit(access, "email-updated", saved);
	return saved;
};

const updateEmail = (server, email, options) =>
	withAccountLock(server, () => updateEmailLocked(server, email, options));

/** The canonical servers the rows, files and settings name: the instance CA, every row, every conf, every folder */
const knownServers = (rows, confs, folders) => {
	const servers = new Set(
		[instanceServer(), ...rows.map((row) => row.server), ...confs.map((conf) => conf.server).filter(Boolean)].map(
			serverKey,
		),
	);
	const covered = new Set([...servers].flatMap((server) => accountDirsOf(server, "")));
	for (const rel of folders) if (!covered.has(rel)) servers.add(serverKey(serverOfFolder(rel)));
	return servers;
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
 * At the start only (nothing runs yet; a running Replace account would lose its folder): removes the temporary folders
 * of a Replace account that a crash interrupted, since they may hold the EAB pair
 */
const sweepReplaceFolders = async () => {
	let entries;
	try {
		entries = await readdir(CERTBOT_DIR, { withFileTypes: true });
	} catch (err) {
		if (err.code === "ENOENT") return;
		throw err;
	}
	for (const entry of entries) {
		if (!(entry.isDirectory() && entry.name.startsWith(REPLACE_PREFIX))) continue;
		await rm(path.join(CERTBOT_DIR, entry.name), { recursive: true, force: true });
		logger.warn(`Removed the leftover Replace account folder ${entry.name}`);
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
	for (const server of knownServers(await acmeAccountModel.query(), confs, await serverFolders())) {
		// under the CA's lock, so a registration running (after a restore or merge) is not overwritten
		await withAccountLock(server, async () => {
			const row = await accountRow(server);
			const accounts = await listAccountIds(server);
			if (row?.state !== "registered" && accounts.length > 0) {
				const named = (id) =>
					confs.filter((conf) => conf.server && serverKey(conf.server) === server && conf.account === id)
						.length;
				// a stable sort keeps the oldest first among accounts named equally often
				const chosen = accounts.toSorted((a, b) => named(b.id) - named(a.id))[0];
				await adoptAccount(server, row, chosen);
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
		const row = await accountRow(conf.server);
		if (row?.state === "registered" && (await accountExists(row.server, row.account_id))) {
			await writeFileAtomic(conf.path, setRenewalParams(conf.text, { account: row.account_id }));
		}
	}
};

/**
 * Certificates from before the column npmpro_acme_server: each Let's Encrypt row without a CA gets the CA of its
 * renewal conf (in the spelling of that CA's account row, else the CA key: a v01 conf names the v02 CA), else the
 * instance CA. Files and rows only: no network, no certbot; a missing renewal folder is no error.
 *
 * @returns {Promise<number>}  the rows filled
 */
const fillCertificateServers = async () => {
	const rows = await certificateModel.query().where("provider", "letsencrypt").whereNull("npmpro_acme_server");
	if (rows.length === 0) return 0;
	const accounts = await acmeAccountModel.query();
	const spelled = (server) => {
		const normal = normalizeServer(server);
		return accounts.find((row) => sameServer(row.server, normal))?.server ?? serverKey(normal);
	};
	const servers = new Map(
		(await listRenewalConfs()).filter((conf) => conf.server).map((conf) => [conf.certificateId, conf.server]),
	);
	for (const row of rows) {
		const server = servers.has(row.id) ? spelled(servers.get(row.id)) : instanceServer();
		await certificateModel.query().where("id", row.id).patch({ npmpro_acme_server: server });
	}
	return rows.length;
};

/**
 * After a restore or a merge of certificates or runtime settings, once the runtime settings are loaded with the
 * restored CA (loadAcmeServer runs before them): rows and files, the renewal options of the CA's certificates and
 * envs.sh's line
 */
const reloadAcmeAfterRestore = async () => {
	await syncAccountsWithFiles();
	await fillCertificateServers();
	await syncRenewalOptions();
	await writeStartupSettings();
};

/**
 * In the background after the start: the instance account's contact follows a set ACME_EMAIL. The start's own
 * `certbot renew` holds certbot's config-dir lock meanwhile, so a "Another instance of Certbot is already running"
 * answer is retried after a delay and is stored as the account error only when the retries run out.
 *
 * @param {Object}  [options]
 * @param {number}  [options.retries]  retries after the first try
 * @param {number}  [options.delayMs]  wait before each retry
 */
const syncEnvEmail = async ({ retries = 6, delayMs = 20_000 } = {}) => {
	if (!acmeEnvSet(process.env).has("ACME_EMAIL")) return;
	const server = instanceServer();
	const row = await accountRow(server);
	if (row?.state !== "registered" || row.email === process.env.ACME_EMAIL) return;
	try {
		// each try takes the CA's lock on its own, so a Settings save is not kept waiting through the delays
		const once = { retries: 0, delayMs: 0 };
		await retryWhileBusy(() => updateEmail(server, process.env.ACME_EMAIL, { retry: once }), { retries, delayMs });
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
	const own = rows.find((row) => sameServer(row.server, server));
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
		refuseValue("email", "must be an email address", "error.invalid-email");
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
	if (changes.server !== undefined) changes.server = normalizeServer(changes.server);
	const before = instanceServer();
	const target = changes.server ?? before;
	const serverChanged = !sameServer(target, before);
	if (serverChanged && !isDirectoryUrl(target)) {
		refuseValue("server", "must be an https ACME directory URL", "error.acme-url");
	}
	const prevValues = (await getRuntimeConfig("certificates")).values;
	let warning;
	await withAccountLock(target, async () => {
		const row = await adoptUsableAccount(target, await accountRow(target));
		const registered = await isRegistered(row);
		const mail = checkedEmail(changes, row);
		const eab = checkedEab(changes, row, registered);
		// a typed URL passes the guard also when its account exists (D6)
		if (serverChanged && registered) await readDirectory(target);
		if (registered) {
			if (mail.changed) await updateEmailLocked(target, mail.email, { access });
		} else if (serverChanged || mail.changed || eab.entered) {
			// the save's target is the instance CA from now on: the env email and EAB pair count for it (D5)
			const values = registrationValues(target, row, { asInstance: true });
			if (mail.given) values.email = mail.email;
			if (eab.entered) values.eab = { kid: eab.kid, hmac: eab.hmac };
			// a stored row keeps its spelling: certbot's folder gets that one (ensureAccountLocked)
			const result = await attemptRegistration(row?.server ?? target, values, {
				blockedIsUnreachable: !serverChanged,
				inSettings: true,
			});
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
	if (!sameServer(target, instanceServer()) && !(await accountRow(target))) {
		throw new errs.ValidationError("This CA has no account in Settings", "error.acme-unknown-ca");
	}
	let warning;
	try {
		await ensureAccount(target, { access, inSettings: true });
	} catch (err) {
		if (err.message_i18n !== "error.acme-unreachable") throw err;
		warning = "unreachable";
	}
	return { ...(await getSettings(access)), ...(warning ? { warning } : {}) };
};

/**
 * GET /settings/acme/profiles: the CA's profiles (5 minute cache), for the Settings profile list (D9)
 *
 * @param   {Access}   access
 * @param   {Object}   [options]
 * @param   {string}   [options.server]  default the instance CA
 * @param   {boolean}  [options.fresh]   read the directory now, not from the cache (the Connect window's check)
 * @returns {Promise<Object>}
 */
const listProfiles = async (access, { server, fresh = false } = {}) => {
	access.canAdmin();
	const target = server === undefined || server === null ? instanceServer() : normalizeServer(server);
	if (!(isDirectoryUrl(target) || isTrustedServer(target, process.env))) {
		refuseValue("server", "must be an https ACME directory URL", "error.acme-url");
	}
	const result = await readDirectory(target, { fresh: fresh === true });
	return {
		reachable: result.reachable,
		directory: result.directory,
		external_account_required: result.external_account_required,
		profiles: Object.entries(result.profiles).map(([name, description]) => ({ name, description })),
	};
};

/** Writes the original text back to confs (best effort: a conf that cannot be written stays for the start repair) */
const restoreConfs = async (confs) => {
	for (const conf of confs) {
		await writeFileAtomic(conf.path, conf.text).catch((err) => {
			logger.warn(`Could not restore ${conf.path} after a failed Replace account: ${err.message}`);
		});
	}
};

/**
 * Rewrites account = in the given renewal confs. When one write fails, the confs written so far get their text back
 * and the error is thrown.
 *
 * @param   {{path: string, text: string}[]}  confs
 * @param   {string}  accountId
 * @param   {Object}  [options]
 * @param   {Function}  [options.write]  (file, text): writes a file (tests inject a failing one)
 * @returns {Promise<number>}  how many confs were rewritten
 */
const rewriteAccountConfs = async (confs, accountId, { write = writeFileAtomic } = {}) => {
	const done = [];
	try {
		for (const conf of confs) {
			await write(conf.path, setRenewalParams(conf.text, { account: accountId }));
			done.push(conf);
		}
	} catch (err) {
		await restoreConfs(done);
		throw err;
	}
	return done.length;
};

/** The folder that holds server's account folders: the one certbot already uses (a symlink is followed), else its own */
const accountsHome = async (server) => {
	for (const dir of accountDirsOf(server)) {
		try {
			return await realpath(dir);
		} catch {
			// not there: the next one, else the own folder
		}
	}
	const own = accountDirsOf(server)[0];
	await mkdir(own, { recursive: true });
	return own;
};

/** The EAB pair a Replace account registers with, null when the CA needs none */
const replaceEab = async (server, body, email) => {
	const directory = await readDirectory(server, { fresh: true });
	if (!directory.reachable) {
		throw new errs.ValidationError(`The ACME server ${server} cannot be reached`, "error.acme-unreachable", {
			values: { server },
		});
	}
	if (!directory.directory) {
		throw new errs.ValidationError(`${server} is not an ACME directory`, "error.acme-not-directory", {
			values: { server },
		});
	}
	const entered = body.eab_kid && body.eab_hmac_key ? { kid: body.eab_kid, hmac: body.eab_hmac_key } : null;
	if (!directory.external_account_required) return null;
	if (entered) return entered;
	if (isZeroSsl(server) && email) return await zeroSslEab(email);
	return refuseValue("eab", "this CA needs an EAB key ID and HMAC key", "error.acme-eab-pair");
};

/**
 * Replace account (D11): a new account at the same CA, the CA's certificates moved to it, the old account kept or
 * deactivated. It all runs under the CA's lock. The new account is registered into a temporary config folder first, so
 * nothing changes when the CA refuses; its folder is then moved next to the old one, the renewal confs name it and the
 * row follows. Only after that is the old account deactivated, when asked; a failure there undoes nothing.
 *
 * @param   {Access}  access
 * @param   {Object}  body
 * @param   {string}  body.server
 * @param   {string}  [body.email]  default the account's current one
 * @param   {string}  [body.eab_kid]
 * @param   {string}  [body.eab_hmac_key]
 * @param   {boolean} [body.deactivate_old]
 * @returns {Promise<Object>}  the GET answer plus replaced: { moved, old_account, deactivation_error? }
 */
const replaceAccount = async (access, body) => {
	access.canAdmin();
	const server = body.server;
	return await withAccountLock(server, async () => {
		const row = await accountRow(server);
		if (!(await isRegistered(row))) {
			throw new errs.ValidationError("Only a registered account can be replaced", "error.acme-not-registered");
		}
		// D5: on the instance CA a set ACME_EMAIL wins over the body, like everywhere else
		const envEmail = sameServer(server, instanceServer()) && acmeEnvSet(process.env).has("ACME_EMAIL");
		let email = body.email === undefined ? (row.email ?? null) : body.email.trim() || null;
		if (envEmail) email = process.env.ACME_EMAIL;
		if (email && !(email.length <= MAX_EMAIL && EMAIL.test(email))) {
			refuseValue("email", "must be an email address", "error.invalid-email");
		}
		// certbot is given the spelling of the account's folder, whatever spelling the body has (ensureAccountLocked)
		const spelling = row.server;
		const eab = await replaceEab(spelling, body, email);
		const secrets = [email, eab?.kid, eab?.hmac];
		const oldId = row.account_id;
		await mkdir(CERTBOT_DIR, { recursive: true });
		const temp = await mkdtemp(path.join(CERTBOT_DIR, REPLACE_PREFIX));
		let moved = null;
		let count = 0;
		try {
			// 1. register into the temporary config folder: nothing in the real one changes
			const config = await writeRunConfig(temp, {
				configDir: path.join(temp, "config"),
				email: email || undefined,
				eab: eab || undefined,
			});
			await runAccountCertbot(registerArgs(config, spelling, { withEmail: Boolean(email) }), secrets);
			const [created] = await listAccountIds(spelling, { accountsDir: path.join(temp, "config/accounts") });
			if (!created) throw noAccountRegistered();
			// 2. its folder moves next to the old one (the real folder may be the one a symlink points to)
			const target = path.join(await accountsHome(spelling), created.id);
			await rename(created.dir, target);
			moved = target;
			// 3. the CA's confs name it, then the row follows
			const confs = (await listRenewalConfs()).filter(
				(conf) => conf.server && serverKey(conf.server) === serverKey(server),
			);
			count = await rewriteAccountConfs(confs, created.id);
			try {
				await acmeAccountModel.query().patchAndFetchById(row.id, {
					account_id: created.id,
					email,
					registered_on: now(),
					eab_kid: null,
					eab_hmac_key: null,
					error: null,
				});
			} catch (err) {
				await restoreConfs(confs);
				throw err;
			}
			moved = null;
		} catch (err) {
			if (moved) await rm(moved, { recursive: true, force: true });
			const failure = err instanceof errs.ValidationError ? err : notPutInPlace(err);
			if (!isBusy(failure)) {
				await audit(access, "replace-failed", row, { error: failure.message }).catch((auditErr) => {
					logger.warn(`Could not record the failed Replace account: ${auditErr.message}`);
				});
			}
			throw failure;
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
		// 4. only now, when asked: the old account is deactivated at the CA
		let oldState = "kept";
		let deactivationError;
		if (body.deactivate_old === true) {
			try {
				await runAccountCertbot(unregisterArgs(CERTBOT_INI, spelling, oldId), []);
				oldState = "deactivated";
			} catch (err) {
				oldState = "deactivation-failed";
				deactivationError = scrub(cleanCertbotMessage(err.message), secrets);
			}
		}
		const saved = await accountRow(server);
		await audit(access, "replaced", saved, {
			old_account: oldId,
			new_account: saved.account_id,
			moved: count,
			old_account_state: oldState,
			...(deactivationError ? { error: deactivationError } : {}),
		});
		return {
			...(await getSettings(access)),
			replaced: {
				moved: count,
				old_account: oldState,
				...(deactivationError ? { deactivation_error: deactivationError } : {}),
			},
		};
	});
};

const internalAcmeAccount = { getSettings, listProfiles, registerNow, replaceAccount, saveSettings };

export {
	accountRow,
	accountView,
	attemptRegistration,
	audit,
	baseIni,
	ensureAccount,
	ensureAccountLocked,
	fillCertificateServers,
	getSettings,
	inRunFolder,
	instanceServer,
	listProfiles,
	loadAcmeServer,
	lockedKeys,
	open,
	prepareRenewalLocked,
	prepareRenewals,
	readAcmeSetting,
	readDirectory,
	refused,
	registerNow,
	registrationValues,
	reloadAcmeAfterRestore,
	replaceAccount,
	rewriteAccountConfs,
	saveAcmeSetting,
	saveSettings,
	scrub,
	seal,
	setBusyRetry,
	setInstanceServer,
	storeRegistered,
	sweepReplaceFolders,
	sweepRunFolders,
	syncAccountsWithFiles,
	syncEnvEmail,
	syncRenewalOptions,
	updateEmail,
	updateEmailLocked,
	upsertRow,
	withAccountLock,
	withAccountLocks,
	withRenewalLock,
	withRenewalLocks,
	writeRunConfig,
};

export default internalAcmeAccount;
