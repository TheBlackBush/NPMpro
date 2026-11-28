import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { GEOIP_DIR } from "../lib/geoip/instance.js";
import { renderGeoipConf, renderGeoipLists } from "../lib/geoip/nginx-conf.js";
import { countryDatabase, hasCustomDirective } from "../lib/geoip/usable.js";
import { getGeoipConfig } from "../lib/monitoring-config.js";
import { rooted } from "../lib/paths.js";
import { nginx as logger } from "../logger.js";
import accessListModel from "../models/access_list.js";
import { reportGeoipState } from "./geoip-state.js";
import internalNginx from "./nginx.js";
import { runtimeExclusive } from "./runtime-queue.js";

const GEOIP_CONF = rooted("/data/npmpro/nginx/geoip.conf");
const GEOIP_LISTS_CONF = rooted("/data/npmpro/nginx/geoip-lists.conf");
const PROXY_HOST_DIR = rooted("/data/nginx/proxy_host");
const GEO_REFERENCE = /\$npmpro_geo_(?<id>\d+)\b/gu;
// NPMpro's own geoip_country line, only in the database variant of geoip.conf
const DATABASE_LINE = /^geoip_country /mu;

const readOrNull = (file) => readFile(file, "utf8").catch(() => null);

/**
 * Whether country rules can work (rule 12): a custom geoip_country directive wins, else the Country file of the active
 * provider must be usable
 *
 * @returns {Promise<{available: boolean, provider: string, custom_directive: boolean, file: string, variant: string}>}
 */
const geoipStatus = async () => {
	const { provider } = (await getGeoipConfig()).values;
	const customDirective = await hasCustomDirective();
	const { usable, file } = await countryDatabase({ dir: GEOIP_DIR, provider });
	let variant = "off";
	if (customDirective) variant = "custom";
	else if (usable) variant = "database";
	return { available: variant !== "off", provider, custom_directive: customDirective, file, variant };
};

/** @returns {Promise<Object[]>}  the access lists whose country mode is not off, with their country codes */
const listsWithMode = async () => {
	const rows = await accessListModel.query().whereNot("npmpro_geo_mode", "off").withGraphFetched("npmpro_countries");
	return rows.map((row) => ({
		id: row.id,
		npmpro_geo_mode: row.npmpro_geo_mode,
		npmpro_geo_unknown: row.npmpro_geo_unknown,
		countries: (row.npmpro_countries ?? []).map(({ country }) => country),
	}));
};

/** @returns {Promise<Set<number>>}  the list ids whose gate variable a proxy host config on disk names */
const referencedLists = async () => {
	const ids = new Set();
	const names = await readdir(PROXY_HOST_DIR).catch(() => []);
	for (const name of names.filter((entry) => entry.endsWith(".conf"))) {
		const text = await readFile(`${PROXY_HOST_DIR}/${name}`, "utf8").catch(() => "");
		for (const match of text.matchAll(GEO_REFERENCE)) ids.add(Number(match.groups.id));
	}
	return ids;
};

// a variable a host config still names while its list has no mode (or is gone): every visitor passes, as the list
// does now; it goes with the next write after the host configs were rewritten
const passingGeo = (id) =>
	`\n# access list ${id}: no country rule (any more), named by a host config until it is rewritten\ngeo $npmpro_geo_${id} {\n  default 1;\n}\n`;

/** Replaces the file in one step (temp file + rename), so nginx never reads an empty or partial include */
const writeAtomic = async (file, content) => {
	const temp = `${file}.tmp-${process.pid}`;
	try {
		await writeFile(temp, content, { encoding: "utf8", mode: 0o644 });
		await rename(temp, file);
	} catch (err) {
		await rm(temp, { force: true });
		throw err;
	}
};

/**
 * Writes geoip-lists.conf from the access lists: one map per list with a country mode, and a passing variable for each
 * list id that a proxy host config on disk still names without such a list (a list turned off or deleted whose hosts
 * are not rewritten yet), so nginx never meets an unknown $npmpro_geo_<id>. No test, no reload; the caller runs it in
 * the runtime settings queue. Then the geoip.failed state is evaluated again (unless report is false).
 *
 * @param   {Object}   [options]
 * @param   {boolean}  [options.report]
 * @returns {Promise<{lists: number}>}  the number of lists with a country mode
 */
const writeGeoipLists = async ({ report = true } = {}) => {
	const lists = await listsWithMode();
	const known = new Set(lists.map(({ id }) => id));
	const stale = [...(await referencedLists())].filter((id) => !known.has(id)).sort((a, b) => a - b);
	await writeAtomic(GEOIP_LISTS_CONF, `${renderGeoipLists(lists)}${stale.map(passingGeo).join("")}`);
	if (report) await reportGeoipState();
	return { lists: lists.length };
};

/**
 * geoip-lists.conf without the database (it could not be read): a passing variable for every list id a proxy host
 * config names, so the host configs still pass nginx -t; every country rule lets visitors pass
 */
const writePassingLists = async () => {
	const ids = [...(await referencedLists())].sort((a, b) => a - b);
	await writeAtomic(GEOIP_LISTS_CONF, `${renderGeoipLists([])}${ids.map(passingGeo).join("")}`);
};

/**
 * Before the nginx -t of a stream, redirection or 404 host save: those configs name no country gate, so only NPMpro's
 * own geoip_country line can fail their test (an own line added since the last sync, or its Country file gone). The
 * sync runs only while geoip.conf has that line; the off and custom variants cannot fail nginx -t, and a proxy host or
 * list save or the hourly tick picks up a change from them. That check reads no database, so a save that cannot be
 * affected costs one file read. For code in the runtime settings queue.
 *
 * @returns {Promise<void>}
 */
const ensureGeoipConf = async () => {
	if (!DATABASE_LINE.test((await readOrNull(GEOIP_CONF)) ?? "")) return;
	await syncGeoipConfNow({ reload: false, report: false });
};

/**
 * Before the nginx -t of a proxy host save (no files: nothing to do): geoip.conf is synced to the variant detected now (the caller reloads), and when
 * one of the written configs names a $npmpro_geo_<id> that geoip-lists.conf does not define (the file lags behind the
 * database, e.g. after a restore), that file is written again. For code in the runtime settings queue.
 *
 * @param   {string[]}  files  the host configs just written
 * @returns {Promise<boolean>}  whether the file was written
 */
const ensureGeoipLists = async (files) => {
	if (files.length === 0) return false;
	// an own geoip_country added or removed since the last sync: the right variant before this save's nginx -t
	await syncGeoipConfNow({ reload: false, report: false });
	const named = new Set();
	for (const file of files) {
		const text = await readOrNull(file);
		for (const match of (text ?? "").matchAll(GEO_REFERENCE)) named.add(match.groups.id);
	}
	if (named.size === 0) return false;
	const defined = (await readOrNull(GEOIP_LISTS_CONF)) ?? "";
	if ([...named].every((id) => defined.includes(`$npmpro_geo_${id} {`))) return false;
	await writeGeoipLists();
	return true;
};

// the [emerg] line of an nginx -t output (the whole output stays at debug level)
const firstError = (err) => {
	const lines = String(err?.message ?? err)
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return (lines.find((line) => line.includes("[emerg]")) ?? lines[0] ?? "").slice(0, 300);
};

// the nginx error of the last database variant that nginx -t refused, while the off variant is on disk for it
let refusal = null;

/** @returns {string|null}  why nginx refused the database variant now on disk as off, null when it did not */
const geoipRefusal = () => refusal;

/**
 * syncGeoipConf for code that runs in the runtime settings queue already (a restore)
 *
 * @param   {Object}   [options]
 * @param   {boolean}  [options.reload]
 * @param   {boolean}  [options.force]
 * @param   {boolean}  [options.report]  evaluate geoip.failed also when nothing changed
 * @param   {Object}   [options.log]
 * @returns {Promise<{variant: string, changed: boolean}>}
 */
const syncGeoipConfNow = async ({ reload = true, force = false, report = true, log = logger } = {}) => {
	const status = await geoipStatus();
	const wanted = renderGeoipConf(status);
	const before = await readOrNull(GEOIP_CONF);
	let variant = status.variant;
	let text = wanted;
	// nginx -t fails because of another file: a reload would fail the same way
	let otherFailure = false;
	if (force || before !== wanted) {
		await writeAtomic(GEOIP_CONF, wanted);
		if (variant !== "off") refusal = null;
		// only NPMpro's own geoip_country line can be the cause: the custom and off variants have none
		if (variant === "database") {
			try {
				await internalNginx.test();
			} catch (err) {
				// the off variant decides: when nginx passes with it, NPMpro's geoip_country line was the cause (a
				// directive the detection missed in an included file, conf.d or after another statement, or a Country
				// file nginx cannot open), so the country rules fail open rather than leave nginx unable to reload
				const off = renderGeoipConf({ variant: "off" });
				await writeAtomic(GEOIP_CONF, off);
				try {
					await internalNginx.test();
					variant = "off";
					text = off;
					refusal = firstError(err);
					log.error(
						`GeoIP: nginx -t refuses the country database line of geoip.conf (${refusal}): country rules of access lists let every visitor pass until it passes again`,
					);
					log.debug(err.message);
				} catch (other) {
					await writeAtomic(GEOIP_CONF, wanted);
					otherFailure = true;
					log.error(
						`GeoIP: nginx -t fails because of another file, geoip.conf keeps the country database (no fallback): ${firstError(other)}`,
					);
					log.debug(other.message);
				}
			}
		}
	}
	const changed = text !== before || (force && variant !== "off");
	if (reload && changed && !otherFailure) {
		try {
			await internalNginx.reload();
		} catch (err) {
			log.error(`GeoIP: nginx could not reload after geoip.conf changed: ${err.message}`);
		}
	}
	if (report || changed) await reportGeoipState();
	return { variant, changed };
};

/**
 * Writes geoip.conf for the current status when its text differs (or force: the Country file was replaced under the
 * same name), then nginx -t. A failure writes the off variant and tests again (R14): when that passes the off variant
 * stays and is logged, else the cause is another file and the database variant is written back. With reload, reloads
 * nginx after a change. Runs in the runtime settings queue.
 *
 * @param   {Object}   [options]
 * @param   {boolean}  [options.reload]
 * @param   {boolean}  [options.force]
 * @param   {Object}   [options.log]
 * @returns {Promise<{variant: string, changed: boolean}>}  the variant on disk
 */
const syncGeoipConf = (options) => runtimeExclusive(() => syncGeoipConfNow(options));

/** @returns {Promise<boolean>}  geoip.conf on disk lets every visitor pass (the off variant, or no file) */
const geoipConfFailsOpen = async () => {
	const text = await readOrNull(GEOIP_CONF);
	return text === null || text === renderGeoipConf({ variant: "off" });
};

/**
 * Startup: both includes before the first config generation, without a reload (the startup reload loads them).
 * Logs when access lists have country rules and no country database is usable.
 *
 * @param   {Object}  [options]
 * @param   {Object}  [options.log]
 * @returns {Promise<void>}
 */
const startGeoipNginx = async ({ log = logger } = {}) => {
	let lists = 0;
	try {
		({ lists } = await writeGeoipLists({ report: false }));
	} catch (err) {
		// the host configs on disk name list variables: without a definition setup's nginx -t takes them offline
		log.error(
			`GeoIP: could not write the country rules of access lists, they let every visitor pass until the next access list save: ${err.message}`,
		);
		await writePassingLists();
	}
	await syncGeoipConfNow({ reload: false, force: true, log });
	if (lists > 0 && !(await geoipStatus()).available) {
		log.warn(
			`GeoIP: ${lists} access list(s) have country rules but no GeoIP country database is usable: every visitor passes until a database is available (Settings, GeoIP)`,
		);
	}
};

export {
	ensureGeoipConf,
	ensureGeoipLists,
	GEOIP_CONF,
	GEOIP_LISTS_CONF,
	geoipConfFailsOpen,
	geoipRefusal,
	geoipStatus,
	startGeoipNginx,
	syncGeoipConf,
	syncGeoipConfNow,
	writeGeoipLists,
};
