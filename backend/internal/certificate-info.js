import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import errs from "../lib/error.js";

const cnPattern = /\bCN=(?<cn>[^\n]+)/iu;

const certificateInfo = {
	checkPrivateKey: (privateKey) => {
		try {
			createPrivateKey(privateKey);
			return true;
		} catch (err) {
			throw new errs.ValidationError(`Certificate Key is not valid (${err.message})`, undefined, { cause: err });
		}
	},

	/**
	 * Parses a PEM string in process (names from the SAN list, else the CN) and checks its dates
	 *
	 * @param {String}  certificate
	 * @param {Boolean} [throwExpired]  Throw when the certificate is out of date
	 */
	getCertificateInfo: (certificate, throwExpired) => {
		const certData = {};

		try {
			const cert = new X509Certificate(certificate);

			if (cert.subjectAltName) {
				certData.cn = cert.subjectAltName
					.split(", ")
					.map((entry) => entry.slice(entry.indexOf(":") + 1).trim());
			} else {
				const cnMatch = cnPattern.exec(cert.subject);
				if (cnMatch?.groups.cn) {
					certData.cn = [cnMatch.groups.cn.trim()];
				} else {
					certData.cn = [];
				}
			}

			if (cert.issuer) {
				certData.issuer = cert.issuer.replaceAll("\n", ", ");
			}

			const validFrom = Math.floor(cert.validFromDate.getTime() / 1000);
			const validTo = Math.floor(cert.validToDate.getTime() / 1000);

			if (Number.isNaN(validFrom) || Number.isNaN(validTo)) {
				throw new errs.ValidationError("Could not determine dates from certificate");
			}

			const now = Math.floor(Date.now() / 1000);
			if (throwExpired && validTo < now) {
				throw new errs.ValidationError("Certificate has expired");
			}

			certData.dates = {
				from: validFrom,
				to: validTo,
			};

			return certData;
		} catch (err) {
			throw new errs.ValidationError(`Certificate is not valid (${err.message})`, undefined, { cause: err });
		}
	},

	getCertificateInfoFromFile: async (certificateFile, throwExpired) => {
		const certContent = await readFile(certificateFile);
		return certificateInfo.getCertificateInfo(certContent, throwExpired);
	},
};

export default certificateInfo;
