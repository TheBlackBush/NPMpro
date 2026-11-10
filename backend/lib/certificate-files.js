import { existsSync } from "node:fs";
import errs from "./error.js";
import { rooted } from "./paths.js";

const liveCertPath = (id) => rooted(`/data/tls/certbot/live/npm-${id}`);
const customCertPath = (id) => rooted(`/data/tls/custom/npm-${id}`);
const mtlsCertFile = (id) => rooted(`/data/tls/mtls/npm-${id}.pem`);

/**
 * The certificate file the host templates load for a certificate row (templates/_common.conf, stream.conf)
 *
 * @param   {{ id: number, provider: string }}  row
 * @returns {string}
 */
const certificateFile = ({ id, provider }) => {
	if (provider === "letsencrypt") return `${liveCertPath(id)}/fullchain.pem`;
	if (provider === "mtls") return mtlsCertFile(id);
	return `${customCertPath(id)}/fullchain.pem`;
};

/**
 * A host's certificate_id needs a server certificate and its npmpro_mtls_certificate_id an mTLS CA, both with their
 * files present; otherwise the host config would only fail at nginx -t.
 *
 * @param {{ id: number, provider: string }} row
 * @param {boolean}  mtls        true for npmpro_mtls_certificate_id, false for certificate_id
 * @param {Function} [fileExists]
 */
const assertCertificateUse = (row, mtls, fileExists = existsSync) => {
	if ((row.provider === "mtls") !== mtls) {
		throw mtls
			? new errs.ValidationError(
					`Certificate #${row.id} is not an mTLS certificate`,
					"error.certificate.not-mtls",
				)
			: new errs.ValidationError(`Certificate #${row.id} is an mTLS certificate`, "error.certificate.is-mtls");
	}
	if (!fileExists(certificateFile(row))) {
		throw new errs.ValidationError(`Certificate #${row.id} has no certificate files`, "error.certificate.no-files");
	}
};

export { assertCertificateUse, certificateFile, customCertPath, liveCertPath, mtlsCertFile };
