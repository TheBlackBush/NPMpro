import { createPrivateKey, X509Certificate } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { customCertPath, mtlsCertFile } from "../lib/certificate-files.js";
import errs from "../lib/error.js";
import { writeSecretFile } from "../lib/secret-file.js";
import { ssl as logger } from "../logger.js";
import certificateInfo from "./certificate-info.js";

const ALLOWED_SSL_FILES = ["certificate", "certificate_key"];

const certificateCustom = {
	writeCustomCert: async (certificate) => {
		if (certificate.provider === "letsencrypt") {
			throw new Error("Refusing to write certbot certs here");
		}

		logger.info("Writing Custom Certificate:", certificate.id);

		if (certificate.provider === "mtls") {
			await writeFile(mtlsCertFile(certificate.id), certificate.certificate);
			return;
		}

		const dir = customCertPath(certificate.id);

		await mkdir(dir, { recursive: true });
		await writeFile(`${dir}/fullchain.pem`, certificate.certificate);
		await writeSecretFile(`${dir}/privkey.pem`, certificate.certificate_key);
		const certs = certificate.certificate.match(/-----BEGIN CERTIFICATE-----.+?-----END CERTIFICATE-----\s*/gsu);
		await writeFile(`${dir}/cert.pem`, certs[0]);
		await writeFile(`${dir}/chain.pem`, certs.slice(1).join(""));
	},

	/** Checks the uploaded files (key readable, certificate valid and not expired, they match); nothing is stored */
	validate: (access, data) => {
		access.can("certificates:manage");
		const finalData = {};
		for (const [name, [file]] of Object.entries(data.files)) {
			if (ALLOWED_SSL_FILES.includes(name)) {
				const content = file.buffer.toString();
				if (name === "certificate_key") {
					finalData[name] = certificateInfo.checkPrivateKey(content);
				} else {
					finalData[name] = certificateInfo.getCertificateInfo(content, true);
				}
			}
		}

		if (
			finalData.certificate &&
			finalData.certificate_key &&
			!new X509Certificate(data.files.certificate[0].buffer).checkPrivateKey(
				createPrivateKey(data.files.certificate_key[0].buffer),
			)
		) {
			throw new errs.ValidationError("Certificate Key does not match the Certificate");
		}

		return finalData;
	},
};

export { ALLOWED_SSL_FILES };
export default certificateCustom;
