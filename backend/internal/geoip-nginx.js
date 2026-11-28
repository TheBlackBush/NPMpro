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
 * the runtime settings queue. Then the geoip.failed state is evaluated again.
 *
 * @returns {Promise<{lists: number}>}  the number of lists with a country mode
 */
const writeGeoipLists = async () => {
	const lists = await listsWithMode();
	const known = new Set(lists.map(({ id }) => id));
	const stale = [...(await referencedLists())].filter((id) => !known.has(id)).sort((a, b) => a - b);
	await writeAtomic(GEOIP_LISTS_CONF, `${renderGeoipLists(lists)}${stale.map(passingGeo).join("")}`);
	await reportGeoipState();
	return { lists: lists.length };
};

/**
 * syncGeoipConf for code that runs in the runtime settings queue already (a restore)
 *
 * @param   {Object}   [options]
 * @param   {boolean}  [options.reload]
 * @param   {boolean}  [options.force]
 * @param   {Object}   [options.log]
 * @returns {Promise<{variant: string, changed: boolean}>}
 */
const syncGeoipConfNow = async ({ reload = true, force = false, log = logger } = {}) => {
	const status = await geoipStatus();
	const wanted = renderGeoipConf(status);
	const before = await readOrNull(GEOIP_CONF);
	let variant = status.variant;
	let text = wanted;
	if (force || before !== wanted) {
		await writeAtomic(GEOIP_CONF, wanted);
		// only NPMpro's own geoip_country line can be the cause: the custom and off variants have none
		if (variant === "database") {
			try {
				await internalNginx.test();
			} catch (err) {
				// a geoip_country the detection missed (an included file, conf.d, after another statement): nginx
				// refuses the duplicate, so the country rules fail open rather than leave nginx unable to reload
				log.error(
					`GeoIP: nginx -t fails with the database variant of geoip.conf, country rules of access lists now let every visitor pass until it passes again: ${err.message}`,
				);
				variant = "off";
				text = renderGeoipConf({ variant });
				await writeAtomic(GEOIP_CONF, text);
			}
		}
	}
	const changed = text !== before || (force && variant !== "off");
	if (reload && changed) {
		try {
			await internalNginx.reload();
		} catch (err) {
			log.error(`GeoIP: nginx could not reload after geoip.conf changed: ${err.message}`);
		}
	}
	await reportGeoipState();
	return { variant, changed };
};

/**
 * Writes geoip.conf for the current status when its text differs (or force: the Country file was replaced under the
 * same name), then nginx -t: a failure writes the off variant and logs it (R14). With reload, reloads nginx after a
 * change. Runs in the runtime settings queue.
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
	const { lists } = await writeGeoipLists();
	await syncGeoipConfNow({ reload: false, force: true, log });
	if (lists > 0 && !(await geoipStatus()).available) {
		log.warn(
			`GeoIP: ${lists} access list(s) have country rules but no GeoIP country database is usable: every visitor passes until a database is available (Settings, GeoIP)`,
		);
	}
};

export {
	GEOIP_CONF,
	GEOIP_LISTS_CONF,
	geoipConfFailsOpen,
	geoipStatus,
	startGeoipNginx,
	syncGeoipConf,
	syncGeoipConfNow,
	writeGeoipLists,
};
