import nodeFs from "node:fs/promises";
import { parseRenewalConf } from "./backup/renewal-conf.js";
import { listRenewalConfs, RENEWAL_DIR, setRenewalParams } from "./certbot-account.js";
import { rooted } from "./paths.js";

// The live certbot config: start.sh copies the image's /etc/certbot.ini here at boot and edits it from env, the
// backend writes it again from the runtime settings (/etc is not writable for PUID)
const CERTBOT_INI = rooted("/run/npmpro/certbot.ini");

// The image's /etc/certbot.ini (rootfs/etc/certbot.ini, kept equal by a test)
const CERTBOT_INI_BASE = `logs-dir = /tmp/certbot-log
work-dir = /tmp/certbot-work
config-dir = /data/tls/certbot
webroot-path = /data/public/acme-challenge

agree-tos = true
non-interactive  = true
no-random-sleep-on-renew = true
no-eff-email = true

rsa-key-size = 4096
elliptic-curve = secp384r1

key-type = ecdsa
no-verify-ssl = false
`;

/**
 * The certbot config (CERTBOT_INI) for the certificate request settings, the same lines start.sh writes for the same env
 *
 * @param   {Object}  values  key_type, key_size, server_tls_verify
 * @param   {string}  [base]  the image's certbot.ini
 * @returns {string}
 */
const renderCertbotIni = (values, base = CERTBOT_INI_BASE) => {
	const rsa = values.key_type === "rsa";
	return base
		.split("\n")
		.map((line) => {
			if (rsa && line.startsWith("rsa-key-size = ")) return `rsa-key-size = ${values.key_size}`;
			if (!rsa && line.startsWith("elliptic-curve = ")) return `elliptic-curve = ${values.key_size}`;
			if (line.startsWith("key-type = ")) return `key-type = ${rsa ? "rsa" : "ecdsa"}`;
			if (line.startsWith("no-verify-ssl = "))
				return `no-verify-ssl = ${values.server_tls_verify ? "false" : "true"}`;
			return line;
		})
		.join("\n");
};

/**
 * The renewal confs of one CA with the instance options (renew takes them from the conf): the profile (no line for
 * none) and must-staple; only the files that change
 *
 * @param   {Object}   options
 * @param   {string}   options.server      the CA whose certificates take these options (the instance CA)
 * @param   {string}   options.profile     "" = none
 * @param   {boolean}  options.mustStaple
 * @param   {string}   [options.dir]
 * @param   {Object}   [options.fs]
 * @returns {Promise<Array<{path: string, content: string}>>}
 */
const renewalOptionEdits = async ({ server, profile, mustStaple, dir = RENEWAL_DIR, fs = nodeFs }) => {
	const edits = [];
	for (const conf of await listRenewalConfs({ dir, fs })) {
		if (conf.server !== server) continue;
		const wanted = { required_profile: profile || null, must_staple: mustStaple ? "True" : "False" };
		const { params } = parseRenewalConf(conf.text);
		// a conf that already holds the wanted values is left alone, whatever the order of its lines
		if (Object.entries(wanted).every(([name, value]) => (params.get(name) ?? null) === value)) continue;
		const content = setRenewalParams(conf.text, wanted);
		if (content !== conf.text) edits.push({ path: conf.path, content });
	}
	return edits;
};

export { CERTBOT_INI, CERTBOT_INI_BASE, renderCertbotIni, renewalOptionEdits };
