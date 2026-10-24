import nodeFs from "node:fs/promises";
import path from "node:path";

// The image's /etc/certbot.ini (rootfs/etc/certbot.ini, kept equal by a test). start.sh edits the file in place at
// boot, so the file on disk is no base to render from.
const CERTBOT_INI_BASE = `logs-dir = /tmp/certbot-log
work-dir = /tmp/certbot-work
config-dir = /data/tls/certbot
webroot-path = /data/tls/certbot/acme-challenge

agree-tos = true
non-interactive  = true
no-random-sleep-on-renew = true
no-eff-email = true

rsa-key-size = 4096
elliptic-curve = secp384r1

#required-profile
key-type = ecdsa
must-staple = true
no-verify-ssl = false
`;

const RENEWAL_DIR = "/data/tls/certbot/renewal";
const PROFILE_LINE = /^#?required-profile(?:\s*=.*)?$/u;
const RENEWAL_PROFILE_LINE = /required_profile/u;

/**
 * /etc/certbot.ini for the certificate request settings, the same lines start.sh writes for the same env
 *
 * @param   {Object}  values  key_type, key_size, must_staple, server_tls_verify, profile ("" = none)
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
			if (line.startsWith("must-staple = ")) return `must-staple = ${values.must_staple ? "true" : "false"}`;
			if (line.startsWith("no-verify-ssl = "))
				return `no-verify-ssl = ${values.server_tls_verify ? "false" : "true"}`;
			if (PROFILE_LINE.test(line))
				return values.profile ? `required-profile = ${values.profile}` : "#required-profile";
			return line;
		})
		.join("\n");
};

const listConfs = async (fs, dir) => {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch (err) {
		if (err.code === "ENOENT") return [];
		throw err;
	}
	const files = [];
	for (const entry of entries) {
		const file = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await listConfs(fs, file)));
		else if (entry.isFile() && entry.name.endsWith(".conf")) files.push(file);
	}
	return files.toSorted((a, b) => a.localeCompare(b));
};

/**
 * The renewal confs that hold a required_profile line, without those lines (start.sh:22 behaviour), so the next
 * renewal uses the profile of certbot.ini
 *
 * @param   {string}  [dir]
 * @param   {Object}  [fs]   node:fs/promises compatible
 * @returns {Promise<Array<{path: string, content: string}>>}  only the files that change
 */
const renewalProfileEdits = async (dir = RENEWAL_DIR, fs = nodeFs) => {
	const edits = [];
	for (const file of await listConfs(fs, dir)) {
		const content = await fs.readFile(file, "utf8");
		const lines = content.split("\n");
		const kept = lines.filter((line) => !RENEWAL_PROFILE_LINE.test(line));
		if (kept.length !== lines.length) edits.push({ path: file, content: kept.join("\n") });
	}
	return edits;
};

/**
 * Removes the required_profile lines from the renewal confs
 *
 * @param   {string}  [dir]
 * @param   {Object}  [fs]
 * @returns {Promise<string[]>}  the changed files
 */
const cleanRenewalProfiles = async (dir = RENEWAL_DIR, fs = nodeFs) => {
	const edits = await renewalProfileEdits(dir, fs);
	for (const edit of edits) await fs.writeFile(edit.path, edit.content);
	return edits.map((edit) => edit.path);
};

export { CERTBOT_INI_BASE, cleanRenewalProfiles, RENEWAL_DIR, renderCertbotIni, renewalProfileEdits };
