import { T } from "src/locale";
import { expiryInfo } from "src/modules/Expiry";
import { ExpiryFormatter } from "./ExpiryFormatter";

const providerTranslations = {
	letsencrypt: "lets-encrypt",
	other: "certificates.custom",
	mtls: "mtls-certificate",
};

export function certificateProviderTranslation(provider) {
	return providerTranslations[provider];
}

export function CertificateFormatter({ certificate }) {
	if (!certificate) {
		return <T id="no-tls" />;
	}
	const showBadge =
		certificate.provider !== "mtls" && certificate.expiresOn && expiryInfo(certificate.expiresOn).state !== "ok";
	return (
		<>
			{certificate.niceName || <T id={certificateProviderTranslation(certificate.provider)} />}
			{showBadge && (
				<>
					{" "}
					<ExpiryFormatter value={certificate.expiresOn} provider={certificate.provider} />
				</>
			)}
		</>
	);
}
