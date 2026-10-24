import { stat } from "node:fs/promises";
import path from "node:path";
import maxmind from "maxmind";

const COUNTRY_FILE = "GeoLite2-Country.mmdb";
const ASN_FILE = "GeoLite2-ASN.mmdb";

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
 * GeoLite2 country and ASN lookups from the files in dir
 *
 * reload() opens new or changed files (compared by mtime) and keeps the previous reader when a new file is invalid.
 * Call it once after creation, after an update and periodically.
 *
 * @param   {Object}  [options]
 * @param   {string}  [options.dir]
 * @param   {number}  [options.cacheSize]
 * @returns {{lookup: Function, available: Function, reload: Function}}
 */
const createGeoip = ({ dir = "/data/goaccess/geoip", cacheSize = 50000 } = {}) => {
	const country = { reader: null, mtimeMs: null };
	const asn = { reader: null, mtimeMs: null };
	let reloading = Promise.resolve();

	return {
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
				await refreshSlot(path.join(dir, COUNTRY_FILE), country, cacheSize);
				await refreshSlot(path.join(dir, ASN_FILE), asn, cacheSize);
			});
			return reloading;
		},
	};
};

export { createGeoip };
