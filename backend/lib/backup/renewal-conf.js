import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import dnsPlugins from "../../certbot/dns-plugins.json" with { type: "json" };
import { BackupError } from "./format.js";

// The renewal conf of an imported Let's Encrypt certificate is rebuilt, never copied: certbot renew runs the *_hook
// commands of every conf and honours the folders it names, so a conf from a file could run commands or move files.
// The rebuilt conf holds the instance's own paths for the new id and only the renewal settings below, checked.

const CREDENTIALS_DIR = "/tmp/certbot-credentials";
const WORK_DIR = "/tmp/certbot-work";
const LOGS_DIR = "/tmp/certbot-log";
const ACCOUNTS = "tls/certbot/accounts";
const ACCOUNT_ID = /^[0-9a-f]{32}$/u;
const SECTION = /^\[\s*(?<name>[^[\]]+?)\s*\]$/u;
const SUBSECTION = /^\[\[\s*(?<name>[^[\]]+?)\s*\]\]$/u;
const LINE = /^(?<name>[^=]+?)\s*=\s*(?<value>.*)$/u;
const VERSION = /^\d+(?:\.\d+)*$/u;
const DOMAIN = /^(?:\*\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*$|^\[?[0-9A-Fa-f:.]+\]?$/u;
const BOOLEAN = /^(?:true|false)$/iu;

// [renewalparams] keys kept as they are when their value passes the check
const CHECKED = {
	server: /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~/-]*)?$/u,
	key_type: /^(?:rsa|ecdsa)$/u,
	elliptic_curve: /^secp(?:256|384|521)r1$/u,
	rsa_key_size: /^\d{4}$/u,
	must_staple: BOOLEAN,
	reuse_key: BOOLEAN,
	preferred_chain: /^[A-Za-z0-9 ._()-]{1,64}$/u,
	pref_challs: /^[a-z0-9-]+(?:,\s*[a-z0-9-]+)*,?$/u,
};
const PROPAGATION = /^\d{1,5}$/u;

const authenticators = () =>
	new Set(["webroot", ...Object.values(dnsPlugins).map((plugin) => plugin.full_plugin_name)]);

const refused = (label, reason) =>
	new BackupError("invalid-item", `The renewal settings of the certificate ${label} cannot be imported: ${reason}`);

/**
 * The renewal conf as { top: Map, params: Map, webrootMap: Map }; comments, unknown sections and lines that are no
 * key = value are left out
 *
 * @param   {string}  text
 * @returns {{ top: Map<string, string>, params: Map<string, string>, webrootMap: Map<string, string> }}
 */
const parseRenewalConf = (text) => {
	const out = { top: new Map(), params: new Map(), webrootMap: new Map() };
	let section = out.top;
	let inParams = false;
	for (const raw of String(text).split("\n")) {
		const line = raw.trim();
		if (line === "" || line.startsWith("#")) continue;
		const sub = SUBSECTION.exec(line);
		if (sub) {
			section = inParams && sub.groups.name === "webroot_map" ? out.webrootMap : null;
			continue;
		}
		const head = SECTION.exec(line);
		if (head) {
			inParams = head.groups.name === "renewalparams";
			section = inParams ? out.params : null;
			continue;
		}
		const pair = LINE.exec(line);
		if (section && pair && !section.has(pair.groups.name)) section.set(pair.groups.name, pair.groups.value.trim());
	}
	return out;
};

/**
 * The renewal conf rebuilt for the certificate with the id on this instance
 *
 * @param   {string}       text
 * @param   {Object}       options
 * @param   {number}       options.id        the certificate's id on this instance
 * @param   {string}       options.dataDir   the data folder (/data)
 * @param   {Set<string>}  options.accounts  the ACME account ids the instance has (after the merge)
 * @param   {string}       [options.label]   names the certificate in an error
 * @returns {string}       rejects with BackupError("invalid-item") when the conf has no known authenticator
 */
const rebuildRenewalConf = (text, { id, dataDir, accounts, label = `#${id}` }) => {
	const { top, params, webrootMap } = parseRenewalConf(text);
	const authenticator = params.get("authenticator");
	if (!authenticator) throw refused(label, "it names no authenticator");
	if (!authenticators().has(authenticator)) throw refused(label, `the authenticator ${authenticator} is unknown`);
	const certbotDir = path.posix.join(dataDir, "tls/certbot");
	const live = `${certbotDir}/live/npm-${id}`;
	const webroot = path.posix.join(dataDir, "public/acme-challenge");
	const prefix = authenticator.replaceAll("-", "_");
	const lines = [];
	if (VERSION.test(top.get("version") ?? "")) lines.push(`version = ${top.get("version")}`);
	lines.push(
		`archive_dir = ${certbotDir}/archive/npm-${id}`,
		`cert = ${live}/cert.pem`,
		`privkey = ${live}/privkey.pem`,
		`chain = ${live}/chain.pem`,
		`fullchain = ${live}/fullchain.pem`,
		"",
		"# Options used in the renewal process",
		"[renewalparams]",
	);
	const account = params.get("account");
	if (ACCOUNT_ID.test(account ?? "") && accounts.has(account)) lines.push(`account = ${account}`);
	lines.push(`authenticator = ${authenticator}`);
	for (const [name, check] of Object.entries(CHECKED)) {
		const value = params.get(name);
		if (value !== undefined && check.test(value)) lines.push(`${name} = ${value}`);
	}
	if (params.has("config_dir")) lines.push(`config_dir = ${certbotDir}`);
	if (params.has("work_dir")) lines.push(`work_dir = ${WORK_DIR}`);
	if (params.has("logs_dir")) lines.push(`logs_dir = ${LOGS_DIR}`);
	if (authenticator === "webroot") {
		lines.push(`webroot_path = ${webroot},`);
		const domains = [...webrootMap.keys()].filter((domain) => DOMAIN.test(domain));
		if (domains.length > 0) lines.push("[[webroot_map]]", ...domains.map((domain) => `${domain} = ${webroot}`));
	} else {
		lines.push(`${prefix}_credentials = ${CREDENTIALS_DIR}/credentials-${id}`);
		const seconds = params.get(`${prefix}_propagation_seconds`);
		if (PROPAGATION.test(seconds ?? "")) lines.push(`${prefix}_propagation_seconds = ${seconds}`);
	}
	return `${lines.join("\n")}\n`;
};

/**
 * The ACME account ids below dir/tls/certbot/accounts (folders named by the account id)
 *
 * @param   {string}  dir  a data folder or a stage's files folder
 * @returns {Promise<Set<string>>}
 */
const accountIds = async (dir) => {
	const found = new Set();
	const walk = async (folder, depth) => {
		let entries;
		try {
			entries = await readdir(folder, { withFileTypes: true });
		} catch (error) {
			if (error.code === "ENOENT" || error.code === "ENOTDIR") return;
			throw error;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (ACCOUNT_ID.test(entry.name)) found.add(entry.name);
			else if (depth < 4) await walk(path.join(folder, entry.name), depth + 1);
		}
	};
	await walk(path.join(dir, ACCOUNTS), 0);
	return found;
};

/**
 * The account ids the renewal confs name
 *
 * @param   {string[]}  texts
 * @returns {Set<string>}
 */
const namedAccounts = (texts) =>
	new Set(
		texts
			.map((text) => parseRenewalConf(text).params.get("account"))
			.filter((account) => ACCOUNT_ID.test(account ?? "")),
	);

/**
 * Refuses a plan whose added certificates have a staged renewal conf that cannot be rebuilt, before anything is written
 *
 * @param   {Object}    options
 * @param   {string}    options.stageDir
 * @param   {string}    options.dataDir
 * @param   {Object[]}  options.items     the plan's items
 * @returns {Promise<void>}  rejects with BackupError("invalid-item") naming the certificate
 */
const checkStagedRenewals = async ({ stageDir, dataDir, items }) => {
	for (const item of items) {
		if (item.type !== "certificates" || item.action !== "add") continue;
		const rel = `tls/certbot/renewal/npm-${item.id}.conf`;
		const staged = path.join(stageDir, "files", rel);
		const info = await lstat(staged).catch(() => null);
		if (!info) continue;
		if (!info.isFile()) throw new BackupError("invalid-archive", `files/${rel} is not a regular file`);
		rebuildRenewalConf(await readFile(staged, "utf8"), {
			id: item.id,
			dataDir,
			accounts: new Set(),
			label: item.label,
		});
	}
};

export { accountIds, CREDENTIALS_DIR, checkStagedRenewals, namedAccounts, parseRenewalConf, rebuildRenewalConf };
