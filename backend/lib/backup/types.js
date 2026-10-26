import path from "node:path";
import { RUNTIME_GROUPS } from "../runtime-rules.js";

// What a backup can hold, by type: the tables, the files under the data folder and how the stored secrets are opened
// for an archive, stripped from it or sealed again with the target's secret box. Every secret function returns new
// rows and leaves its input as it is. Paths are relative to the data folder, without a leading or trailing slash.

const CATEGORIES = [
	{ id: "hosts", types: ["proxy_hosts", "redirection_hosts", "dead_hosts", "streams"] },
	{ id: "certificates", types: ["certificates"] },
	{ id: "access_lists", types: ["access_lists"] },
	{ id: "dns_credentials", types: ["dns_credentials"] },
	{ id: "users", types: ["users"] },
	{ id: "settings", types: ["settings_runtime", "settings_default_site", "settings_oidc", "settings_monitoring"] },
	{ id: "custom_files", types: ["custom_nginx", "crowdsec_files"] },
];

const RESTORE_ORDER = [
	"users",
	"dns_credentials",
	"certificates",
	"access_lists",
	"proxy_hosts",
	"redirection_hosts",
	"dead_hosts",
	"streams",
	"settings_runtime",
	"settings_default_site",
	"settings_oidc",
	"settings_monitoring",
	"custom_nginx",
	"crowdsec_files",
];

const SEALED_PREFIX = "v1:";
const SECRET_AUTH_TYPES = new Set(["password", "totp", "totp_pending", "backup_code"]);
const TOTP_AUTH_TYPES = new Set(["totp", "totp_pending"]);
const PRIVATE_KEY = /^privkey\d*\.pem$/u;

const isSealed = (value) => typeof value === "string" && value.startsWith(SEALED_PREFIX);

// a relative path of plain names: no empty, "." or ".." parts
const isPlainPath = (rel) =>
	typeof rel === "string" &&
	rel !== "" &&
	rel.split("/").every((part) => part !== "" && part !== "." && part !== "..");

// rel is root itself or lies below it
const isUnder = (root) => (rel) => rel === root || rel.startsWith(`${root}/`);

// the folders that lead to the given paths ("a/b/c" -> "a", "a/b")
const parentsOf = (paths) =>
	new Set(
		paths.flatMap((rel) => {
			const parts = rel.split("/");
			return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join("/"));
		}),
	);

/**
 * @param   {Object}      options
 * @param   {string[]}    options.roots    the files and folders export copies (folders recursively, through allow)
 * @param   {Function[]}  options.matches  (rel) => boolean, the allowed files and folders
 * @param   {Function}    [options.secret] (rel) => boolean, files left out when a backup has no secrets
 */
const fileRules = ({ roots, matches, secret = () => false }) => {
	const parents = parentsOf(roots);
	return {
		roots,
		allow: (rel) =>
			isPlainPath(rel) && (parents.has(rel) || roots.includes(rel) || matches.some((match) => match(rel))),
		secret: (rel) => isPlainPath(rel) && secret(rel),
	};
};

const NO_FILES = fileRules({ roots: [], matches: [] });

const NO_SECRETS = {
	export: (rowsByTable) => rowsByTable,
	strip: (rowsByTable) => rowsByTable,
	seal: (rowsByTable) => rowsByTable,
};

// rowsByTable with fn applied to each row of table
const mapRows = (rowsByTable, table, fn) =>
	Array.isArray(rowsByTable[table]) ? { ...rowsByTable, [table]: rowsByTable[table].map(fn) } : rowsByTable;

/**
 * Secret handling for one sealed key in the meta of the setting rows with the given id.
 *
 * @param   {string}  id
 * @param   {string}  key
 */
const settingMetaSecret = (id, key) => {
	const onRow = (fn) => (rowsByTable) =>
		mapRows(rowsByTable, "setting", (row) =>
			row.id === id && row.meta && typeof row.meta === "object" && Object.hasOwn(row.meta, key) ? fn(row) : row,
		);
	return {
		export: (rowsByTable, box) =>
			onRow((row) =>
				isSealed(row.meta[key]) ? { ...row, meta: { ...row.meta, [key]: box.decrypt(row.meta[key]) } } : row,
			)(rowsByTable),
		strip: onRow((row) => {
			const { [key]: _removed, ...meta } = row.meta;
			return { ...row, meta };
		}),
		seal: (rowsByTable, box) =>
			onRow((row) =>
				typeof row.meta[key] === "string" && row.meta[key] !== ""
					? { ...row, meta: { ...row.meta, [key]: box.encrypt(row.meta[key]) } }
					: row,
			)(rowsByTable),
	};
};

const settingRows = (ids) => [{ table: "setting", where: (qb) => qb.whereIn("id", ids) }];

const CERTIFICATE_FILES = [
	/^tls\/certbot\/archive\/npm-\d+$/u,
	/^tls\/certbot\/archive\/npm-\d+\/[a-z]+\d+\.pem$/u,
	/^tls\/certbot\/renewal\/npm-\d+\.conf$/u,
	/^tls\/certbot\/accounts(?:\/[A-Za-z0-9._-]+)*$/u,
	/^tls\/custom\/npm-\d+$/u,
	/^tls\/custom\/npm-\d+\/[a-z_]+\.pem$/u,
	/^tls\/custom\/npm-\d+\.der$/u,
	/^tls\/certbot\/live\/npm-\d+\.der$/u,
	/^tls\/mtls\/npm-\d+\.pem$/u,
].map((pattern) => (rel) => pattern.test(rel));

const CROWDSEC_FILES = ["crowdsec/crowdsec.conf", "crowdsec/ban.html", "crowdsec/captcha.html"];

const TYPES = {
	proxy_hosts: {
		tables: [{ table: "proxy_host" }, { table: "npmpro_location" }, { table: "npmpro_proxy_host_access_list" }],
		files: NO_FILES,
		secrets: NO_SECRETS,
	},
	redirection_hosts: { tables: [{ table: "redirection_host" }], files: NO_FILES, secrets: NO_SECRETS },
	dead_hosts: { tables: [{ table: "dead_host" }], files: NO_FILES, secrets: NO_SECRETS },
	streams: { tables: [{ table: "stream" }], files: NO_FILES, secrets: NO_SECRETS },
	certificates: {
		tables: [{ table: "certificate" }],
		// live/npm-<id>/ holds symlinks into archive/ and is recreated on restore; only the .der files next to it
		files: fileRules({
			roots: [
				"tls/certbot/archive",
				"tls/certbot/renewal",
				"tls/certbot/accounts",
				"tls/certbot/live",
				"tls/custom",
				"tls/mtls",
			],
			matches: CERTIFICATE_FILES,
			secret: (rel) =>
				PRIVATE_KEY.test(path.posix.basename(rel)) ||
				(rel.startsWith("tls/certbot/accounts/") && path.posix.basename(rel) === "private_key.json"),
		}),
		secrets: NO_SECRETS,
	},
	access_lists: {
		tables: [{ table: "access_list" }, { table: "access_list_auth" }, { table: "access_list_client" }],
		files: NO_FILES,
		secrets: {
			...NO_SECRETS,
			// the passwords are hashes; blank ones let nobody in until a password is set
			strip: (rowsByTable) => mapRows(rowsByTable, "access_list_auth", (row) => ({ ...row, password: "" })),
		},
	},
	dns_credentials: {
		tables: [{ table: "npmpro_dns_credential" }],
		files: NO_FILES,
		secrets: {
			export: (rowsByTable, box) =>
				mapRows(rowsByTable, "npmpro_dns_credential", (row) =>
					isSealed(row.values) ? { ...row, values: box.decrypt(row.values) } : row,
				),
			strip: (rowsByTable) => mapRows(rowsByTable, "npmpro_dns_credential", (row) => ({ ...row, values: {} })),
			seal: (rowsByTable, box) =>
				mapRows(rowsByTable, "npmpro_dns_credential", (row) =>
					isSealed(row.values) ? row : { ...row, values: box.encrypt(row.values ?? {}) },
				),
		},
	},
	users: {
		tables: [{ table: "user" }, { table: "auth" }, { table: "user_permission" }],
		files: fileRules({ roots: ["public/avatar"], matches: [isUnder("public/avatar")] }),
		secrets: {
			// TOTP secrets are sealed as { totp }; rows from before are plaintext base32 (lib/totp-secret.js)
			export: (rowsByTable, box) =>
				mapRows(rowsByTable, "auth", (row) =>
					TOTP_AUTH_TYPES.has(row.type) && isSealed(row.secret)
						? { ...row, secret: box.decrypt(row.secret).totp }
						: row,
				),
			// password and backup code hashes go too: these users cannot sign in until an admin sets a password
			strip: (rowsByTable) =>
				Array.isArray(rowsByTable.auth)
					? { ...rowsByTable, auth: rowsByTable.auth.filter((row) => !SECRET_AUTH_TYPES.has(row.type)) }
					: rowsByTable,
			seal: (rowsByTable, box) =>
				mapRows(rowsByTable, "auth", (row) =>
					TOTP_AUTH_TYPES.has(row.type) && typeof row.secret === "string" && row.secret !== ""
						? { ...row, secret: box.encrypt({ totp: row.secret }) }
						: row,
				),
		},
	},
	settings_runtime: { tables: settingRows(RUNTIME_GROUPS), files: NO_FILES, secrets: NO_SECRETS },
	settings_default_site: {
		tables: settingRows(["default-site"]),
		files: fileRules({ roots: ["public/html"], matches: [isUnder("public/html")] }),
		secrets: NO_SECRETS,
	},
	settings_oidc: {
		tables: settingRows(["oidc"]),
		files: NO_FILES,
		secrets: settingMetaSecret("oidc", "client_secret"),
	},
	settings_monitoring: {
		tables: settingRows(["monitoring", "geoip"]),
		files: NO_FILES,
		secrets: settingMetaSecret("geoip", "license_key"),
	},
	custom_nginx: {
		tables: [],
		files: fileRules({ roots: ["custom_nginx"], matches: [isUnder("custom_nginx")] }),
		secrets: NO_SECRETS,
	},
	crowdsec_files: {
		tables: [],
		files: fileRules({
			roots: CROWDSEC_FILES,
			matches: [(rel) => CROWDSEC_FILES.includes(rel)],
			// holds the bouncer API key
			secret: (rel) => rel === "crowdsec/crowdsec.conf",
		}),
		secrets: NO_SECRETS,
	},
};

const FILES_PREFIX = "files/";

/**
 * The allow callback for extractTo: whether one of the chosen types takes the archive path.
 *
 * @param   {string[]}  types             type ids
 * @param   {string}    relUnderArchive   e.g. files/custom_nginx/http.conf
 * @returns {boolean}
 */
const allowFile = (types, relUnderArchive) => {
	if (typeof relUnderArchive !== "string" || !relUnderArchive.startsWith(FILES_PREFIX)) return false;
	const rel = relUnderArchive.slice(FILES_PREFIX.length);
	return types.some((type) => Object.hasOwn(TYPES, type) && TYPES[type].files.allow(rel));
};

export { allowFile, CATEGORIES, RESTORE_ORDER, TYPES };
