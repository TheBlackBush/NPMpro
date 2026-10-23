import { Field, useFormikContext } from "formik";
import { useEffect } from "react";
import { DNSProviderFields, DomainNamesField, SwitchField } from "src/components";
import { T } from "src/locale";

export function SSLOptionsFields({ forHttp = true, forProxyHost }) {
	const { values: v, setFieldValue } = useFormikContext();

	const newCertificate = v?.certificateId === "new";
	const hasCertificate = newCertificate || v?.certificateId > 0;
	const {
		sslForced,
		npmproHttp3Support,
		hstsEnabled,
		hstsSubdomains,
		npmproDnsChallenge: dnsChallenge,
		npmproReuseKey: reuseKey,
		npmproMtlsCertificateId,
		npmproMtlsVerifyClientOptional,
		npmproMtlsBypassAuthRequest,
	} = v;

	const mtlsBypassAuthRequestPossible =
		npmproMtlsVerifyClientOptional &&
		[v, ...(v.locations ?? [])].some(({ npmproAuthRequest = "none" }) => npmproAuthRequest !== "none");
	const mtlsRequired = npmproMtlsCertificateId > 0 && !npmproMtlsVerifyClientOptional;

	useEffect(() => {
		if (!forHttp && newCertificate && !dnsChallenge) void setFieldValue("npmproDnsChallenge", true);
		if (forHttp && mtlsRequired && !sslForced) void setFieldValue("sslForced", true);
	});

	const handleToggleChange = (e, fieldName) => {
		void setFieldValue(fieldName, e.target.checked);
		if (fieldName === "npmproDnsChallenge" && !e.target.checked) {
			void setFieldValue("npmproDnsProvider", undefined);
			void setFieldValue("npmproDnsCredentialId", undefined);
			void setFieldValue("npmproPropagationSeconds", undefined);
		}
		if (fieldName === "sslForced" && !e.target.checked) {
			void setFieldValue("hstsEnabled", false);
			void setFieldValue("hstsSubdomains", false);
		}
		if (fieldName === "hstsEnabled" && !e.target.checked) {
			void setFieldValue("hstsSubdomains", false);
		}
	};

	const getHttpOptions = () => (
		<>
			<Field name="sslForced">
				{({ field }) => (
					<SwitchField
						id="sslForced"
						label={<T id="domains.force-ssl" />}
						checked={sslForced}
						onChange={(e) => handleToggleChange(e, field.name)}
						disabled={!hasCertificate || mtlsRequired}
					/>
				)}
			</Field>
			<Field name="npmproHttp3Support">
				{({ field }) => (
					<SwitchField
						id="npmproHttp3Support"
						label={<T id="domains.http3-support" />}
						checked={npmproHttp3Support}
						onChange={(e) => handleToggleChange(e, field.name)}
						disabled={!hasCertificate}
					/>
				)}
			</Field>
			<Field name="hstsEnabled">
				{({ field }) => (
					<SwitchField
						id="hstsEnabled"
						label={<T id="host.flags.hsts-enabled" />}
						checked={hstsEnabled}
						onChange={(e) => handleToggleChange(e, field.name)}
						disabled={!hasCertificate || !sslForced}
					/>
				)}
			</Field>
			<Field name="hstsSubdomains">
				{({ field }) => (
					<SwitchField
						id="hstsSubdomains"
						label={<T id="host.flags.hsts-subdomains" />}
						checked={hstsSubdomains}
						onChange={(e) => handleToggleChange(e, field.name)}
						disabled={!hasCertificate || !hstsEnabled}
					/>
				)}
			</Field>
		</>
	);

	return (
		<div>
			<div className="divide-y">
				<Field name="npmproMtlsVerifyClientOptional">
					{({ field }) => (
						<SwitchField
							id="npmproMtlsVerifyClientOptional"
							label={<T id="domains.mtls-verify-client-optional" />}
							checked={npmproMtlsVerifyClientOptional}
							onChange={(e) => handleToggleChange(e, field.name)}
							disabled={!(v?.certificateId > 0 && npmproMtlsCertificateId > 0)}
						/>
					)}
				</Field>
				{forProxyHost ? (
					<Field name="npmproMtlsBypassAuthRequest">
						{({ field }) => (
							<SwitchField
								id="npmproMtlsBypassAuthRequest"
								label={<T id="domains.mtls-bypass-auth-request" />}
								checked={npmproMtlsBypassAuthRequest === true && mtlsBypassAuthRequestPossible}
								onChange={(e) => handleToggleChange(e, field.name)}
								disabled={!mtlsBypassAuthRequestPossible}
							/>
						)}
					</Field>
				) : null}
				{forHttp ? getHttpOptions() : null}
				{newCertificate ? (
					<>
						<Field name="npmproReuseKey">
							{({ field }) => (
								<SwitchField
									id="npmproReuseKey"
									label={<T id="domains.reuse-key" />}
									checked={Boolean(reuseKey)}
									onChange={(e) => handleToggleChange(e, field.name)}
								/>
							)}
						</Field>
						<Field name="npmproDnsChallenge">
							{({ field }) => (
								<SwitchField
									id="npmproDnsChallenge"
									label={<T id="domains.use-dns" />}
									checked={!forHttp || Boolean(dnsChallenge)}
									onChange={(e) => handleToggleChange(e, field.name)}
									disabled={!forHttp}
								/>
							)}
						</Field>
					</>
				) : null}
			</div>
			{newCertificate && !forHttp ? (
				<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported forCertificate />
			) : null}
			{newCertificate && dnsChallenge ? <DNSProviderFields showBoundaryBox /> : null}
		</div>
	);
}
