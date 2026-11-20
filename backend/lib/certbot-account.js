import { randomBytes } from "node:crypto";
import nodeFs from "node:fs/promises";
import path from "node:path";
import { parseRenewalConf } from "./backup/renewal-conf.js";
import { rooted } from "./paths.js";

// certbot's ACME account folders (<config-dir>/accounts/<netloc><path>/<id>/), the config file of one register or
// update_account run (the email and EAB pair live there, never on certbot's command line, which certbot logs), and
// the renewal conf lines NPMpro edits (account, required_profile, must_staple).

const CERTBOT_DIR = rooted("/data/tls/certbot");
const ACCOUNTS_DIR = rooted("/data/tls/certbot/accounts");
const RENEWAL_DIR = rooted("/data/tls/certbot/renewal");
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const SCHEME = /^[a-z]+:\/\//u;
const CONF_NAME = /^npm-(?<id>\d+)\.conf$/u;
const FOLDER_LINE = /^(?<key>logs-dir|work-dir|config-dir)\s*=/u;
const ACCOUNT_LINE = /^(?:email|eab-kid|eab-hmac-key)\s*=/u;
const PARAM_LINE = /^(?<name>[a-z_]+)\s*=/u;
// a line break would add a config key of its own (a hook), so no value of the run config may hold one (a function,
// not a regex: Biome refuses control characters in a regex)
const hasControl = (value) => [...String(value)].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const MAX_DEPTH = 5;

// certbot's LE_REUSE_SERVERS: an account folder made for the v01 directory serves the v02 one
const LE_REUSE = {
	"acme-v02.api.letsencrypt.org/directory": "acme-v01.api.letsencrypt.org/directory",
	"acme-staging-v02.api.letsencrypt.org/directory": "acme-staging.api.letsencrypt.org/directory",
};
const LE_REUSED_BY = Object.fromEntries(Object.entries(LE_REUSE).map(([v02, v01]) => [v01, v02]));

/** certbot's configuration.server_path: the directory URL without its scheme */
const serverPath = (server) => server.replace(SCHEME, "");

/** @returns {string}  the server whose accounts a folder (relative to the accounts folder) holds */
const serverOfFolder = (rel) => `https://${LE_REUSED_BY[rel] ?? rel}`;

/** The folders certbot reads a server's accounts from: its own, then the one it reuses */
const accountDirsOf = (server, accountsDir = ACCOUNTS_DIR) => {
	const own = serverPath(server);
	return [own, LE_REUSE[own]].filter(Boolean).map((rel) => path.join(accountsDir, rel));
};

const createdOf = async (fs, dir) => {
	try {
		const time = Date.parse(JSON.parse(await fs.readFile(path.join(dir, "meta.json"), "utf8")).creation_dt);
		return Number.isNaN(time) ? null : time;
	} catch {
		return null;
	}
};

const readDirOrEmpty = async (fs, dir) => {
	try {
		return await fs.readdir(dir, { withFileTypes: true });
	} catch (err) {
		if (err.code === "ENOENT" || err.code === "ENOTDIR") return [];
		throw err;
	}
};

const hasKey = async (fs, dir) => {
	try {
		return (await fs.stat(path.join(dir, "private_key.json"))).isFile();
	} catch {
		return false;
	}
};

/**
 * @returns {Promise<{id: string, dir: string, created: number|null}[]>}  the server's usable accounts (a folder with
 *          its private_key.json: a backup without secrets restores the folder without it), oldest first (an account
 *          without a creation time last)
 */
const listAccountIds = async (server, { accountsDir = ACCOUNTS_DIR, fs = nodeFs } = {}) => {
	const found = new Map();
	for (const dir of accountDirsOf(server, accountsDir)) {
		for (const entry of await readDirOrEmpty(fs, dir)) {
			if (!(entry.isDirectory() && ACCOUNT_ID.test(entry.name)) || found.has(entry.name)) continue;
			const accountDir = path.join(dir, entry.name);
			if (!(await hasKey(fs, accountDir))) continue;
			found.set(entry.name, { id: entry.name, dir: accountDir, created: await createdOf(fs, accountDir) });
		}
	}
	const order = (entry) => entry.created ?? Number.POSITIVE_INFINITY;
	return [...found.values()].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
};

const accountExists = async (server, id, options) =>
	typeof id === "string" && (await listAccountIds(server, options)).some((entry) => entry.id === id);

/** @returns {Promise<string[]>}  the folders (relative, sorted) that directly hold account folders */
const serverFolders = async ({ accountsDir = ACCOUNTS_DIR, fs = nodeFs } = {}) => {
	const found = new Set();
	const walk = async (rel, depth) => {
		for (const entry of await readDirOrEmpty(fs, path.join(accountsDir, rel))) {
			const isDir = entry.isDirectory() || entry.isSymbolicLink();
			if (!isDir) continue;
			if (ACCOUNT_ID.test(entry.name)) {
				if (rel && (await hasKey(fs, path.join(accountsDir, rel, entry.name)))) found.add(rel);
			} else if (depth < MAX_DEPTH) await walk(rel ? `${rel}/${entry.name}` : entry.name, depth + 1);
		}
	};
	await walk("", 0);
	return [...found].sort((a, b) => a.localeCompare(b));
};

const checked = (value) => {
	if (hasControl(value)) throw new Error("An ACME account value holds a line break or control character");
	return value;
};

/**
 * The config of one certbot register, update_account or unregister run: the live certbot.ini without account lines,
 * with the run's own folders (certbot locks them per run) and the account values
 *
 * @param   {string}  baseIni
 * @param   {Object}  options
 * @param   {string}  options.logsDir
 * @param   {string}  options.workDir
 * @param   {string}  [options.configDir]  another config-dir (Replace account: a temporary one)
 * @param   {string}  [options.email]
 * @param   {{kid: string, hmac: string}}  [options.eab]
 * @returns {string}
 */
const accountConfigText = (baseIni, { logsDir, workDir, configDir, email, eab }) => {
	const folders = { "logs-dir": logsDir, "work-dir": workDir, "config-dir": configDir };
	const seen = new Set();
	const lines = baseIni
		.trimEnd()
		.split("\n")
		.filter((line) => !ACCOUNT_LINE.test(line.trim()))
		.map((line) => {
			const key = FOLDER_LINE.exec(line.trim())?.groups.key;
			if (!(key && folders[key])) return line;
			seen.add(key);
			return `${key} = ${checked(folders[key])}`;
		});
	// a base without these lines must not make the run share the live folders
	for (const [key, value] of Object.entries(folders)) {
		if (value && !seen.has(key)) lines.push(`${key} = ${checked(value)}`);
	}
	if (email) lines.push(`email = ${checked(email)}`);
	if (eab) lines.push(`eab-kid = ${checked(eab.kid)}`, `eab-hmac-key = ${checked(eab.hmac)}`);
	return `${lines.join("\n").trimEnd()}\n`;
};

const noEmail = (withEmail) => (withEmail ? [] : ["--register-unsafely-without-email"]);

const registerArgs = (configFile, server, { withEmail }) => [
	"--config",
	configFile,
	"register",
	"--server",
	server,
	...noEmail(withEmail),
];

const updateEmailArgs = (configFile, server, accountId, { withEmail }) => [
	"--config",
	configFile,
	"update_account",
	"--server",
	server,
	"--account",
	accountId,
	...noEmail(withEmail),
];

const unregisterArgs = (configFile, server, accountId) => [
	"--config",
	configFile,
	"unregister",
	"--server",
	server,
	"--account",
	accountId,
];

/** The flags of the options a request passes for its CA (requestOptionsFor); certbot keeps them in the renewal conf */
const requestOptionArgs = ({ profile, must_staple: mustStaple }) => [
	...(profile ? ["--required-profile", profile] : []),
	...(mustStaple ? ["--must-staple"] : []),
];

/** @returns {Promise<{path: string, certificateId: number, text: string, server: ?string, account: ?string}[]>} */
const listRenewalConfs = async ({ dir = RENEWAL_DIR, fs = nodeFs } = {}) => {
	const out = [];
	const entries = (await readDirOrEmpty(fs, dir)).filter((entry) => entry.isFile() && CONF_NAME.test(entry.name));
	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const file = path.join(dir, entry.name);
		const text = await fs.readFile(file, "utf8");
		const { params } = parseRenewalConf(text);
		out.push({
			path: file,
			certificateId: Number(CONF_NAME.exec(entry.name).groups.id),
			text,
			server: params.get("server") ?? null,
			account: params.get("account") ?? null,
		});
	}
	return out;
};

/**
 * Sets renewal params: each named key's lines in [renewalparams] go, a non-null value comes back as one line right
 * after the section header. A conf without [renewalparams] is not one certbot wrote and stays as it is.
 *
 * @param   {string}  text
 * @param   {Object<string, string|null>}  changes
 * @returns {string}
 */
const setRenewalParams = (text, changes) => {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => line.trim() === "[renewalparams]");
	if (start === -1) return text;
	const next = lines.findIndex((line, index) => index > start && line.trim().startsWith("["));
	const end = next === -1 ? lines.length : next;
	const kept = lines.filter((line, index) => {
		if (index <= start || index >= end) return true;
		const name = PARAM_LINE.exec(line.trim())?.groups.name;
		return !(name && Object.hasOwn(changes, name));
	});
	const added = Object.entries(changes)
		.filter(([, value]) => value !== null)
		.map(([name, value]) => `${name} = ${checked(value)}`);
	kept.splice(start + 1, 0, ...added);
	return kept.join("\n");
};

/** Writes a file next to it first and renames it over, so a reader never sees half a file */
const writeFileAtomic = async (file, content, { fs = nodeFs, mode = 0o644 } = {}) => {
	const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await fs.writeFile(temp, content, { mode });
		await fs.rename(temp, file);
	} catch (err) {
		await fs.rm(temp, { force: true });
		throw err;
	}
};

export {
	ACCOUNTS_DIR,
	accountConfigText,
	accountDirsOf,
	accountExists,
	CERTBOT_DIR,
	listAccountIds,
	listRenewalConfs,
	RENEWAL_DIR,
	registerArgs,
	requestOptionArgs,
	serverFolders,
	serverOfFolder,
	serverPath,
	setRenewalParams,
	unregisterArgs,
	updateEmailArgs,
	writeFileAtomic,
};
