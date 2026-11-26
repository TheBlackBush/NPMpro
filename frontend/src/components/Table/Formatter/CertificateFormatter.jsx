import { useWarningDays } from "src/hooks";
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
	const days = useWarningDays();
	if (!certificate) {
		return <T id="no-tls" />;
	}
	const validFrom = certificate.npmproValidFrom;
	const showBadge =
		certificate.provider !== "mtls" &&
		certificate.expiresOn &&
		expiryInfo(certificate.expiresOn, { validFrom, days }).state !== "ok";
	return (
		<>
			{certificate.niceName || <T id={certificateProviderTranslation(certificate.provider)} />}
			{showBadge && (
				<>
					{" "}
					<ExpiryFormatter
						value={certificate.expiresOn}
						provider={certificate.provider}
						validFrom={validFrom}
					/>
				</>
			)}
		</>
	);
}
