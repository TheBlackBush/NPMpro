import { existsSync } from "node:fs";
import errs from "./error.js";

/**
 * The certificate file the host templates load for a certificate row (templates/_common.conf, stream.conf)
 *
 * @param   {{ id: number, provider: string }}  row
 * @returns {string}
 */
const certificateFile = ({ id, provider }) => {
	if (provider === "letsencrypt") return `/data/tls/certbot/live/npm-${id}/fullchain.pem`;
	if (provider === "mtls") return `/data/tls/mtls/npm-${id}.pem`;
	return `/data/tls/custom/npm-${id}/fullchain.pem`;
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

export { assertCertificateUse, certificateFile };
