/**
 * The countries of the access list rules: the code list (the same 250 codes the backend accepts, pinned by a test),
 * their names in the UI language and the picker's search. Pure, so node --test checks them without a DOM.
 */

export const COUNTRY_CODES = Object.freeze([
	"AD",
	"AE",
	"AF",
	"AG",
	"AI",
	"AL",
	"AM",
	"AO",
	"AQ",
	"AR",
	"AS",
	"AT",
	"AU",
	"AW",
	"AX",
	"AZ",
	"BA",
	"BB",
	"BD",
	"BE",
	"BF",
	"BG",
	"BH",
	"BI",
	"BJ",
	"BL",
	"BM",
	"BN",
	"BO",
	"BQ",
	"BR",
	"BS",
	"BT",
	"BV",
	"BW",
	"BY",
	"BZ",
	"CA",
	"CC",
	"CD",
	"CF",
	"CG",
	"CH",
	"CI",
	"CK",
	"CL",
	"CM",
	"CN",
	"CO",
	"CR",
	"CU",
	"CV",
	"CW",
	"CX",
	"CY",
	"CZ",
	"DE",
	"DJ",
	"DK",
	"DM",
	"DO",
	"DZ",
	"EC",
	"EE",
	"EG",
	"EH",
	"ER",
	"ES",
	"ET",
	"FI",
	"FJ",
	"FK",
	"FM",
	"FO",
	"FR",
	"GA",
	"GB",
	"GD",
	"GE",
	"GF",
	"GG",
	"GH",
	"GI",
	"GL",
	"GM",
	"GN",
	"GP",
	"GQ",
	"GR",
	"GS",
	"GT",
	"GU",
	"GW",
	"GY",
	"HK",
	"HM",
	"HN",
	"HR",
	"HT",
	"HU",
	"ID",
	"IE",
	"IL",
	"IM",
	"IN",
	"IO",
	"IQ",
	"IR",
	"IS",
	"IT",
	"JE",
	"JM",
	"JO",
	"JP",
	"KE",
	"KG",
	"KH",
	"KI",
	"KM",
	"KN",
	"KP",
	"KR",
	"KW",
	"KY",
	"KZ",
	"LA",
	"LB",
	"LC",
	"LI",
	"LK",
	"LR",
	"LS",
	"LT",
	"LU",
	"LV",
	"LY",
	"MA",
	"MC",
	"MD",
	"ME",
	"MF",
	"MG",
	"MH",
	"MK",
	"ML",
	"MM",
	"MN",
	"MO",
	"MP",
	"MQ",
	"MR",
	"MS",
	"MT",
	"MU",
	"MV",
	"MW",
	"MX",
	"MY",
	"MZ",
	"NA",
	"NC",
	"NE",
	"NF",
	"NG",
	"NI",
	"NL",
	"NO",
	"NP",
	"NR",
	"NU",
	"NZ",
	"OM",
	"PA",
	"PE",
	"PF",
	"PG",
	"PH",
	"PK",
	"PL",
	"PM",
	"PN",
	"PR",
	"PS",
	"PT",
	"PW",
	"PY",
	"QA",
	"RE",
	"RO",
	"RS",
	"RU",
	"RW",
	"SA",
	"SB",
	"SC",
	"SD",
	"SE",
	"SG",
	"SH",
	"SI",
	"SJ",
	"SK",
	"SL",
	"SM",
	"SN",
	"SO",
	"SR",
	"SS",
	"ST",
	"SV",
	"SX",
	"SY",
	"SZ",
	"TC",
	"TD",
	"TF",
	"TG",
	"TH",
	"TJ",
	"TK",
	"TL",
	"TM",
	"TN",
	"TO",
	"TR",
	"TT",
	"TV",
	"TW",
	"TZ",
	"UA",
	"UG",
	"UM",
	"US",
	"UY",
	"UZ",
	"VA",
	"VC",
	"VE",
	"VG",
	"VI",
	"VN",
	"VU",
	"WF",
	"WS",
	"XK",
	"YE",
	"YT",
	"ZA",
	"ZM",
	"ZW",
]);

const namers = new Map();
const KNOWN = new Set(COUNTRY_CODES);
const collators = new Map();

const collatorOf = (locale) => {
	if (!collators.has(locale)) {
		try {
			collators.set(locale, new Intl.Collator(locale));
		} catch {
			collators.set(locale, new Intl.Collator());
		}
	}
	return collators.get(locale);
};

/**
 * The name of a country in a language, or the code when the language has none or the code is outside the list
 *
 * @param   {string} code    two capital letters
 * @param   {string} locale  the UI language
 * @returns {string}
 */
export const countryName = (code, locale) => {
	// ZZ and the like are valid region codes for Intl ("Unknown Region"), but not countries of the list
	if (!KNOWN.has(code)) return code;
	try {
		if (!namers.has(locale))
			namers.set(locale, new Intl.DisplayNames([locale], { type: "region", fallback: "code" }));
		return namers.get(locale).of(code) ?? code;
	} catch {
		return code;
	}
};

// lower case without accents, so "ä" finds "a" and "Côte" finds "cote"
const fold = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * The codes whose name (in the language) or code contains the query, sorted by name
 *
 * @param   {string}   query   what the user typed (blank: every code)
 * @param   {string}   locale  the UI language
 * @param   {string[]} codes   the codes to search
 * @returns {string[]}
 */
export const searchCountries = (query, locale, codes = COUNTRY_CODES) => {
	const needle = fold(query.trim());
	const named = codes.map((code) => ({ code, name: countryName(code, locale) }));
	return named
		.filter(({ code, name }) => needle === "" || fold(name).includes(needle) || fold(code).includes(needle))
		.sort((a, b) => collatorOf(locale).compare(a.name, b.name))
		.map(({ code }) => code);
};

/**
 * @param   {string} code
 * @returns {boolean}  whether the list has the code
 */
export const isKnownCountry = (code) => KNOWN.has(code);
