const PRIVATE_RANGES = [
	"127.0.0.0/8",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"169.254.0.0/16",
	"100.64.0.0/10",
	"::1/128",
	"fc00::/7",
	"fe80::/10",
];

const geoVariable = (id) => `$npmpro_geo_${id}`;

const SAFE_PATH = /^[A-Za-z0-9/._-]+$/u;
const COUNTRY_CODE = /^[A-Z]{2}$/u;

/**
 * The geoip.conf include
 *
 * @param   {Object}  args
 * @param   {string}  args.variant  "database" (file required), "custom" or "off"
 * @param   {string}  [args.file]   absolute path of the Country database
 * @returns {string}
 */
const renderGeoipConf = ({ variant, file }) => {
	if (variant === "database") {
		if (typeof file !== "string" || !SAFE_PATH.test(file)) throw new Error("The GeoIP database path is not usable");
		return `# GeoIP country database of the active provider (Settings, GeoIP), written by NPMpro\ngeoip_country ${file};\ngeo $npmpro_geo_db {\n  default 1;\n}\n`;
	}
	if (variant === "custom") {
		return "# geoip_country comes from /data/custom_nginx (your own directive wins, Settings, GeoIP)\ngeo $npmpro_geo_db {\n  default 1;\n}\n";
	}
	if (variant !== "off") throw new Error(`Unknown GeoIP include variant: ${variant}`);
	return "# no usable GeoIP country database: country rules of access lists let every visitor pass (Settings, GeoIP)\ngeo $npmpro_geo_db {\n  default 0;\n}\n";
};

const privateGeo = () =>
	`geo $npmpro_geo_private {\n  default 0;\n${PRIVATE_RANGES.map((range) => `  ${range} 1;\n`).join("")}}\n`;

const unknownResult = (list, allow) => {
	if (list.npmpro_geo_unknown === "pass") return 1;
	if (list.npmpro_geo_unknown === "block") return 0;
	return allow ? 0 : 1;
};

const renderList = (list) => {
	if (!Number.isInteger(list.id) || list.id < 1)
		throw new Error(`The access list id is not a positive integer: ${list.id}`);
	const allow = list.npmpro_geo_mode === "allow";
	const unknown = unknownResult(list, allow);
	const countries = [...new Set(list.countries ?? [])]
		.filter((code) => COUNTRY_CODE.test(code))
		.sort((a, b) => (a < b ? -1 : 1));
	const lines = [
		`# access list ${list.id}: ${allow ? "allow only these countries" : "block these countries"}, ${unknown === 1 ? "unknown passes" : "unknown blocked"}`,
		`map "$npmpro_geo_db:$npmpro_geo_private:$geoip_country_code" ${geoVariable(list.id)} {`,
		`  default ${allow ? 0 : 1};`,
		'  "~^0:" 1;',
		'  "~^1:1:" 1;',
		`  "1:0:" ${unknown};`,
		...countries.map((code) => `  "1:0:${code}" ${allow ? 1 : 0};`),
		"}",
	];
	return `${lines.join("\n")}\n`;
};

/**
 * The geoip-lists.conf include
 *
 * @param   {Object[]}  lists  [{ id, npmpro_geo_mode, npmpro_geo_unknown, countries: string[] }], modes "off" are left out
 * @returns {string}
 */
const renderGeoipLists = (lists) => {
	const used = lists
		.filter((list) => list.npmpro_geo_mode === "allow" || list.npmpro_geo_mode === "deny")
		.sort((a, b) => a.id - b.id);
	return `# the country rules of access lists (written by NPMpro from the access lists)\n${privateGeo()}${used.map((list) => `\n${renderList(list)}`).join("")}`;
};

export { geoVariable, PRIVATE_RANGES, renderGeoipConf, renderGeoipLists };
