import nodeFs from "node:fs/promises";

/**
 * The default certificate of the default host and the admin UI: an include with its ssl_certificate, ssl_certificate_key
 * and stapling lines, written by start.sh at boot (from DEFAULT_CERT_ID) and by the backend from the runtime settings.
 * The path rules are the ones of start.sh.
 */

const DEFAULT_CERT_CONF = "/data/npmpro/nginx/default-cert.conf";
const TLS_DIR = "/data/tls";
const STAPLING_KEYS = ["ocsp_stapling", "custom_ocsp_stapling"];

const statOf = async (fs, file) => {
	try {
		return await fs.stat(file);
	} catch {
		return null;
	}
};

const isDir = async (fs, file) => (await statOf(fs, file))?.isDirectory() === true;
// test -s: exists and is not empty (follows links, like the certbot live files)
const hasContent = async (fs, file) => ((await statOf(fs, file))?.size ?? 0) > 0;

const builtIn = (tlsDir = TLS_DIR) => ({
	cert: `${tlsDir}/dummycert.pem`,
	key: `${tlsDir}/dummykey.pem`,
	stapling: null,
});

/**
 * The files of the default certificate (start.sh rules: the certbot folder first, then the custom one; fullchain.pem and
 * privkey.pem must not be empty; the .der stapling file only when it is not empty and stapling is on for its kind).
 *
 * @param   {number}  id            default_certificate_id, 0 = built-in
 * @param   {Array<{id: number}>}  certificates  the certificates that exist (a missing id gives the built-in one)
 * @param   {Object}  [options]
 * @param   {Object}  [options.stapling]  { acme: boolean, custom: boolean }
 * @param   {Object}  [options.fs]        node:fs/promises compatible
 * @param   {string}  [options.tlsDir]
 * @returns {Promise<{cert: string, key: string, stapling: string|null}|null>}  null: the built-in certificate
 */
const defaultCertificatePaths = async (
	id,
	certificates,
	{ stapling = { acme: false, custom: false }, fs = nodeFs, tlsDir = TLS_DIR } = {},
) => {
	if (!Number.isInteger(id) || id === 0) return null;
	if (!certificates.some((certificate) => certificate.id === id)) return null;

	const kinds = [
		{ dir: `${tlsDir}/certbot/live/npm-${id}`, der: `${tlsDir}/certbot/live/npm-${id}.der`, staple: stapling.acme },
		{ dir: `${tlsDir}/custom/npm-${id}`, der: `${tlsDir}/custom/npm-${id}.der`, staple: stapling.custom },
	];
	for (const kind of kinds) {
		if (!(await isDir(fs, kind.dir))) continue;
		const cert = `${kind.dir}/fullchain.pem`;
		const key = `${kind.dir}/privkey.pem`;
		if (!((await hasContent(fs, cert)) && (await hasContent(fs, key)))) return null;
		return { cert, key, stapling: kind.staple === true && (await hasContent(fs, kind.der)) ? kind.der : null };
	}
	return null;
};

/**
 * @param   {{cert: string, key: string, stapling: string|null}|null}  paths  null: the built-in certificate
 * @param   {string}  [tlsDir]
 * @returns {string}  the include (the same lines start.sh writes)
 */
const renderDefaultCertConf = (paths, tlsDir = TLS_DIR) => {
	const { cert, key, stapling } = paths ?? builtIn(tlsDir);
	const lines = [`ssl_certificate ${cert};`, `ssl_certificate_key ${key};`];
	if (stapling) {
		lines.push(
			"ssl_stapling on;",
			"ssl_stapling_verify on;",
			`ssl_stapling_file ${stapling};`,
			"ssl_certificate_compression off;",
		);
	}
	return `${lines.join("\n")}\n`;
};

/**
 * The OCSP response file nginx staples for a host's certificate and the stapling kind it follows
 *
 * @param   {Object}  host    with certificate_id and the certificate relation
 * @param   {string}  [tlsDir]
 * @returns {{file: string, kind: "acme"|"custom", env: string}|null}  null without a certificate
 */
const staplingFileOf = (host, tlsDir = TLS_DIR) => {
	if (!(host.certificate_id > 0) || !host.certificate) return null;
	return host.certificate.provider === "letsencrypt"
		? { file: `${tlsDir}/certbot/live/npm-${host.certificate_id}.der`, kind: "acme", env: "ACME_OCSP_STAPLING" }
		: { file: `${tlsDir}/custom/npm-${host.certificate_id}.der`, kind: "custom", env: "CUSTOM_OCSP_STAPLING" };
};

/**
 * Whether the host's OCSP response file exists and is not empty (start.sh's test -s); a host staples only then, so
 * certificates without an OCSP responder do not break nginx -t when stapling is on
 *
 * @param   {Object}  host
 * @param   {Object}  [options]
 * @param   {Object}  [options.fs]
 * @param   {string}  [options.tlsDir]
 * @returns {Promise<boolean>}
 */
const hasStaplingFile = async (host, { fs = nodeFs, tlsDir = TLS_DIR } = {}) => {
	const stapling = staplingFileOf(host, tlsDir);
	return stapling !== null && (await hasContent(fs, stapling.file));
};

/**
 * Whether a host's config depends on the changed stapling keys: certbot certificates follow ocsp_stapling, custom
 * ones custom_ocsp_stapling
 *
 * @param   {Object}    host     with certificate_id and the certificate relation
 * @param   {string[]}  changed  changed keys
 * @returns {boolean}
 */
const stapledHost = (host, changed) => {
	const stapling = staplingFileOf(host);
	return stapling !== null && changed.includes(stapling.kind === "acme" ? "ocsp_stapling" : "custom_ocsp_stapling");
};

export {
	DEFAULT_CERT_CONF,
	defaultCertificatePaths,
	hasStaplingFile,
	renderDefaultCertConf,
	STAPLING_KEYS,
	stapledHost,
	staplingFileOf,
	TLS_DIR,
};
