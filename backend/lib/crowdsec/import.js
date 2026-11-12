import nodeFs from "node:fs/promises";
import { global as logger } from "../../logger.js";
import { defaultSecretBox } from "../secret-box.js";
import { CROWDSEC_CONF_PATH, parseConfLines } from "./config.js";
import { HEADER, SECRET_KEYS, valuesFromFile } from "./settings.js";
import { readStoredCrowdsec, saveStoredCrowdsec } from "./store.js";

const LOCAL_PATH = `${CROWDSEC_CONF_PATH}.local`;
const FIRST_LINE = /\r?\n/u;
const NOT_DIGITS = /[^\d]/gu;

// the text of a file a person wrote; null when it is missing, not a regular file (a link is never followed) or
// already written by NPMpro
const readHandEdited = async (fs, file, log) => {
	let info;
	try {
		info = await fs.lstat(file);
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}
	if (!info.isFile()) {
		log.warn(`CrowdSec: ${file} is not a regular file and is not imported`);
		return null;
	}
	const text = await fs.readFile(file, "utf8");
	return text.replace(/^﻿/u, "").split(FIRST_LINE, 1)[0] === HEADER ? null : text;
};

// <file>.before-settings, with the time when that name is taken
const keepName = async (fs, file, now) => {
	const name = `${file}.before-settings`;
	try {
		await fs.lstat(name);
	} catch (err) {
		if (err.code === "ENOENT") return name;
		throw err;
	}
	return `${name}-${now.toISOString().replaceAll(NOT_DIGITS, "").slice(0, 14)}`;
};

/**
 * Imports a hand-edited crowdsec.conf (with crowdsec.conf.local on top, as the bouncer reads them) into the row once:
 * the old file is copied to crowdsec.conf.before-settings before the row is saved, the .local file is renamed after.
 * Without such a file the row is created empty (the defaults). Unknown keys and refused values are logged by
 * name, never with their values.
 *
 * @param   {Object}   [deps]
 * @param   {Object}   [deps.fs]
 * @param   {Object}   [deps.log]
 * @param   {Object}   [deps.box]
 * @param   {Function} [deps.now]  () => Date
 * @returns {Promise<{ imported: boolean, unknown: string[], dropped: string[] }>}
 */
const importCrowdsecFile = async ({
	fs = nodeFs,
	log = logger,
	box = defaultSecretBox,
	now = () => new Date(),
} = {}) => {
	const stored = await readStoredCrowdsec();
	const text = await readHandEdited(fs, CROWDSEC_CONF_PATH, log);
	const local = await readHandEdited(fs, LOCAL_PATH, log);
	if (text === null && local === null) {
		await saveStoredCrowdsec({ ...stored });
		return { imported: false, unknown: [], dropped: [] };
	}
	const { values, unknown, dropped } = valuesFromFile({
		...parseConfLines(text ?? ""),
		...parseConfLines(local ?? ""),
	});
	const meta = { ...values, imported_on: now().toISOString() };
	for (const key of SECRET_KEYS) {
		if (values[key] === "") delete meta[key];
		else meta[key] = box.encrypt(values[key]);
	}
	const kept = text === null ? null : await keepName(fs, CROWDSEC_CONF_PATH, now());
	if (kept) await fs.copyFile(CROWDSEC_CONF_PATH, kept);
	await saveStoredCrowdsec(meta);
	if (local !== null) {
		// the row is saved already: a failed rename is a warning, the start goes on (the startup block warns about the file)
		try {
			await fs.rename(LOCAL_PATH, await keepName(fs, LOCAL_PATH, now()));
		} catch (err) {
			log.warn(`CrowdSec: ${LOCAL_PATH} could not be renamed (${err.code ?? err.message}), remove it by hand`);
		}
	}
	log.info(
		`CrowdSec: the bouncer config was imported into Settings, CrowdSec${kept ? `, the old file is kept as ${kept}` : ""}`,
	);
	if (unknown.length > 0) log.warn(`CrowdSec: keys not taken over from the old file: ${unknown.join(", ")}`);
	if (dropped.length > 0) log.warn(`CrowdSec: invalid values replaced by the defaults: ${dropped.join(", ")}`);
	return { imported: true, unknown, dropped };
};

/**
 * For a database without a crowdsec row while the data folder holds the file NPMpro wrote (a restore of an older
 * backup): the row is made from that file, so the working settings are not replaced by the defaults. The file holds the
 * effective values, so an environment override that was active is stored too.
 *
 * @param   {Object}   [deps]
 * @param   {Object}   [deps.fs]
 * @param   {Object}   [deps.log]
 * @param   {Object}   [deps.box]
 * @returns {Promise<boolean>} whether a row was made
 */
const recoverCrowdsecFromWrittenFile = async ({ fs = nodeFs, log = logger, box = defaultSecretBox } = {}) => {
	let text;
	try {
		if (!(await fs.lstat(CROWDSEC_CONF_PATH)).isFile()) return false;
		text = await fs.readFile(CROWDSEC_CONF_PATH, "utf8");
	} catch (err) {
		if (err.code === "ENOENT") return false;
		throw err;
	}
	if (text.split(FIRST_LINE, 1)[0] !== HEADER) return false;
	const { values } = valuesFromFile(parseConfLines(text));
	const meta = { ...values };
	for (const key of SECRET_KEYS) {
		if (values[key] === "") delete meta[key];
		else meta[key] = box.encrypt(values[key]);
	}
	await saveStoredCrowdsec(meta);
	log.warn(
		"CrowdSec: the restored database has no CrowdSec settings, the current ones were read back from the written file",
	);
	return true;
};

export { importCrowdsecFile, recoverCrowdsecFromWrittenFile };
