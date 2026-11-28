import { readFileSync } from "node:fs";
import errs from "./error.js";

const COUNTRY_CODES = new Set(JSON.parse(readFileSync(new URL("./country-codes.json", import.meta.url), "utf8")));

const isAll = (address) => String(address).trim().toLowerCase() === "all";

/**
 * The access rules with an address; rows without one are left out (the form sends them empty)
 *
 * @param   {Array<{ address?: string, directive: string }>}  [clients]
 * @returns {Array}
 */
const clientsWithAddress = (clients = []) => clients.filter(({ address }) => String(address ?? "").trim() !== "");

/**
 * The rules nginx can not check for an access list: each username once (htpasswd matches the first line only), and
 * an "all" rule only as the last rule (nginx stops at the first match, so an earlier "allow all" opens the list).
 * Only checks what the request sends: items or clients left out keep the saved ones.
 *
 * @param {Object} data  { items, clients } of a create or update request
 */
const assertAccessListRules = ({ items, clients } = {}) => {
	if (items && new Set(items.map(({ username }) => username)).size !== items.length) {
		throw new errs.ValidationError("Access list usernames need to be unique", "error.access.duplicate-usernames");
	}
	if (clients) {
		const rules = clientsWithAddress(clients);
		if (rules.some(({ address }, index) => isAll(address) && index !== rules.length - 1)) {
			throw new errs.ValidationError(
				"An all access rule can only be the last rule",
				"error.access.all-rule-last",
			);
		}
	}
};

/**
 * The country rules of a create (row null) or update: a mode other than off needs a country; a code not saved on the
 * list must be on the code list; without a usable database only a change that keeps or removes is allowed (rule 6).
 * Only checks what the request sends.
 *
 * @param {Object}      data       { npmpro_geo_mode, npmpro_countries }
 * @param {Object|null} row        the saved list with npmpro_countries, or null
 * @param {{ available: boolean }} status  geoipStatus()
 */
const assertCountryRules = (data, row, status) => {
	const sentCodes = data.npmpro_countries?.map(({ country }) => country);
	if (data.npmpro_geo_mode === undefined && !sentCodes) return;
	const savedCodes = (row?.npmpro_countries ?? []).map(({ country }) => country);
	const savedMode = row?.npmpro_geo_mode ?? "off";
	const mode = data.npmpro_geo_mode ?? savedMode;
	const codes = sentCodes ?? savedCodes;

	if (sentCodes) {
		const seen = new Set();
		for (const code of sentCodes) {
			if (seen.has(code)) {
				throw new errs.ValidationError(`${code} is listed twice`, "error.access.country-duplicate", {
					values: { code },
				});
			}
			seen.add(code);
			if (!COUNTRY_CODES.has(code) && !savedCodes.includes(code)) {
				throw new errs.ValidationError(`${code} is not a known country code`, "error.access.country-unknown", {
					values: { code },
				});
			}
		}
	}
	if (mode !== "off" && codes.length === 0) {
		throw new errs.ValidationError(
			"Choose at least one country or turn the country rules off",
			"error.access.country-mode-empty",
		);
	}
	if (
		!status.available &&
		mode !== "off" &&
		(mode !== savedMode || codes.some((code) => !savedCodes.includes(code)))
	) {
		throw new errs.ValidationError(
			"Country rules need a GeoIP country database: choose a provider in Settings, GeoIP",
			"error.access.country-no-database",
		);
	}
};

export { assertAccessListRules, assertCountryRules, clientsWithAddress };
