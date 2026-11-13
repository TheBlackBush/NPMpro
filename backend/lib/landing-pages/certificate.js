import { access } from "node:fs/promises";
import { rooted } from "../paths.js";

// A host that forces HTTPS while its certificate's files are gone (deleted, a failed renewal that removed them):
// nginx -t would refuse its config and take it offline. Instead it is rendered without its HTTPS listener and plain
// HTTP answers with the certificate problem page (templates/_common.conf). The same paths as _common.conf.

const defaultExists = async (file) => {
	try {
		await access(rooted(file));
		return true;
	} catch {
		return false;
	}
};

/**
 * @param   {Object}   host  with ssl_forced, certificate_id and the certificate relation
 * @param   {Object}   [deps]
 * @param   {Function} [deps.exists]  async (container path) => boolean
 * @returns {Promise<boolean>}
 */
export const certificateUnusable = async (host, { exists = defaultExists } = {}) => {
	if (!host.certificate || host.ssl_forced !== true) return false;
	const base =
		host.certificate.provider === "letsencrypt"
			? `/data/tls/certbot/live/npm-${host.certificate_id}`
			: `/data/tls/custom/npm-${host.certificate_id}`;
	return !((await exists(`${base}/fullchain.pem`)) && (await exists(`${base}/privkey.pem`)));
};
