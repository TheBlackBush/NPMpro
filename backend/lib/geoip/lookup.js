import { stat } from "node:fs/promises";
import path from "node:path";
import maxmind from "maxmind";
import { rooted } from "../paths.js";
import { asnFileOf, countryFileOf } from "./providers.js";

/**
 * Opens a database only when its file changed since the last load
 *
 * @param   {string}  file
 * @param   {Object}  slot    { reader, mtimeMs }
 * @param   {number}  cacheSize
 */
const refreshSlot = async (file, slot, cacheSize) => {
	let mtimeMs;
	try {
		mtimeMs = (await stat(file)).mtimeMs;
	} catch {
		slot.reader = null;
		slot.mtimeMs = null;
		return;
	}
	if (slot.reader && slot.mtimeMs === mtimeMs) return;
	try {
		slot.reader = await maxmind.open(file, { cache: { max: cacheSize } });
		slot.mtimeMs = mtimeMs;
	} catch {
		// unreadable or corrupt: keep serving the previous reader, retry on the next change
		slot.mtimeMs = mtimeMs;
	}
};

/**
 * GeoLite2 country and ASN lookups from the files in dir. country is country.iso_code of the record (null when absent,
 * registered_country is not used). reload() opens new or changed files (by mtime) and keeps the previous reader when a
 * new file is invalid; call it after creation, after an update and periodically.
 *
 * @param   {Object}  [options]
 * @param   {string}  [options.dir]
 * @param   {number}  [options.cacheSize]
 * @param   {string}  [options.provider]  the provider whose files are opened (dbip or maxmind)
 * @returns {{lookup: Function, available: Function, reload: Function, setProvider: Function, provider: Function}}
 */
const createGeoip = ({ dir = rooted("/data/goaccess/geoip"), cacheSize = 50000, provider = "dbip" } = {}) => {
	const country = { reader: null, mtimeMs: null };
	const asn = { reader: null, mtimeMs: null };
	let reloading = Promise.resolve();
	let current = provider;
	let generation = 0;
	let countryFile = countryFileOf(current);
	let asnFile = asnFileOf(current);

	const clear = (slot) => {
		slot.reader = null;
		slot.mtimeMs = null;
	};

	return {
		provider: () => current,
		/** Opens the files of another provider: both readers are cleared until the next reload() */
		setProvider: (id) => {
			const nextCountry = countryFileOf(id);
			const nextAsn = asnFileOf(id);
			current = id;
			if (nextCountry === countryFile && nextAsn === asnFile) return;
			countryFile = nextCountry;
			asnFile = nextAsn;
			generation++;
			clear(country);
			clear(asn);
		},
		lookup: (ip) => {
			if (!maxmind.validate(ip)) return null;
			const countryRecord = country.reader?.get(ip);
			const asnRecord = asn.reader?.get(ip);
			return {
				country: countryRecord?.country?.iso_code ?? null,
				asn: asnRecord?.autonomous_system_number ?? null,
				asnName: asnRecord?.autonomous_system_organization ?? null,
			};
		},
		available: () => ({ country: country.reader !== null, asn: asn.reader !== null }),
		reload: () => {
			reloading = reloading.then(async () => {
				const started = generation;
				await refreshSlot(path.join(dir, countryFile), country, cacheSize);
				await refreshSlot(path.join(dir, asnFile), asn, cacheSize);
				// a switch while the files were opened: what was opened may belong to the old provider
				if (started !== generation) {
					clear(country);
					clear(asn);
				}
			});
			return reloading;
		},
	};
};

export { createGeoip };
