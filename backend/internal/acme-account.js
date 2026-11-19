import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import dayjs from "dayjs";
import { dispatcherFor, readAcmeDirectory } from "../lib/acme-directory.js";
import {
	acmeEnvSet,
	isTrustedServer,
	isZeroSsl,
	resolveAcmeServer,
	serverKey,
	setStoredAcmeServer,
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
import { CERTBOT_INI, CERTBOT_INI_BASE } from "../lib/certbot-ini.js";
import errs from "../lib/error.js";
import { rooted } from "../lib/paths.js";
import { getRuntimeConfig } from "../lib/runtime-config.js";
import { defaultSecretBox } from "../lib/secret-box.js";
import { ssl as logger } from "../logger.js";
import acmeAccountModel from "../models/acme_account.js";
import now from "../models/now_helper.js";
import settingModel from "../models/setting.js";
import internalAuditLog from "./audit-log.js";

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
		return { outcome: "unreachable", message: `The ACME server ${server} cannot be reached (${directory.error})` };
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

/** The servers the rows, files and settings name: the instance CA, every row, every conf's server, every account folder */
const knownServers = (rows, confs, folders) => {
	const servers = new Set([
		instanceServer(),
		...rows.map((row) => row.server),
		...confs.map((conf) => conf.server).filter(Boolean),
	]);
	const covered = new Set([...servers].flatMap((server) => accountDirsOf(server, "")));
	for (const rel of folders) if (!covered.has(rel)) servers.add(serverOfFolder(rel));
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
 * The start (and a restore or merge): a row for an account folder whose CA has no registered row (the account most
 * confs of the CA name, then the oldest; the email is ACME_EMAIL for the instance CA, else not recorded), registered
 * rows whose folder is gone back to pending, confs naming a missing account pointed at their CA's registered account.
 * File checks only: no network, no certbot.
 */
const syncAccountsWithFiles = async () => {
	const confs = await listRenewalConfs();
	const instance = instanceServer();
	for (const server of knownServers(await acmeAccountModel.query(), confs, await serverFolders())) {
		const row = await accountRow(server);
		const accounts = await listAccountIds(server);
		if (row?.state !== "registered" && accounts.length > 0) {
			const named = (id) => confs.filter((conf) => conf.server === server && conf.account === id).length;
			// a stable sort keeps the oldest first among accounts named equally often
			const chosen = accounts.toSorted((a, b) => named(b.id) - named(a.id))[0];
			const email =
				row?.email ??
				(server === instance && acmeEnvSet(process.env).has("ACME_EMAIL") ? process.env.ACME_EMAIL : null);
			await upsertRow(server, row, {
				email,
				account_id: chosen.id,
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
	}
	for (const conf of confs) {
		if (!conf.server || (await accountExists(conf.server, conf.account))) continue;
		const row = await accountRow(conf.server);
		if (row?.state === "registered" && (await accountExists(conf.server, row.account_id))) {
			await writeFileAtomic(conf.path, setRenewalParams(conf.text, { account: row.account_id }));
		}
	}
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

export {
	accountRow,
	accountView,
	attemptRegistration,
	audit,
	baseIni,
	ensureAccount,
	inRunFolder,
	instanceServer,
	loadAcmeServer,
	open,
	readAcmeSetting,
	readDirectory,
	refused,
	registrationValues,
	saveAcmeSetting,
	scrub,
	seal,
	storeRegistered,
	sweepRunFolders,
	syncAccountsWithFiles,
	syncEnvEmail,
	updateEmail,
	updateEmailLocked,
	upsertRow,
	withAccountLock,
	writeRunConfig,
};
