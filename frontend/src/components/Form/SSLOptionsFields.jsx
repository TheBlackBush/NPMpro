import cn from "clsx";
import { Field, useFormikContext } from "formik";
import { useEffect } from "react";
import { DNSProviderFields, DomainNamesField } from "src/components";
import { T } from "src/locale";

export function SSLOptionsFields({ forHttp = true, forProxyHost, color }) {
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

	const toggleClasses = "form-check-input";
	const toggleEnabled = cn(toggleClasses, color);

	const getHttpOptions = () => (
		<div>
			<div className="row">
				<div className="col-6">
					<Field name="sslForced">
						{({ field }) => (
							<label className="form-check form-switch mt-1">
								<input
									className={sslForced ? toggleEnabled : toggleClasses}
									type="checkbox"
									checked={sslForced}
									onChange={(e) => handleToggleChange(e, field.name)}
									disabled={!hasCertificate || mtlsRequired}
								/>

								<span className="form-check-label">
									<T id="domains.force-ssl" />
								</span>
							</label>
						)}
					</Field>
				</div>
				<div className="col-6">
					<Field name="npmproHttp3Support">
						{({ field }) => (
							<label className="form-check form-switch mt-1">
								<input
									className={npmproHttp3Support ? toggleEnabled : toggleClasses}
									type="checkbox"
									checked={npmproHttp3Support}
									onChange={(e) => handleToggleChange(e, field.name)}
									disabled={!hasCertificate}
								/>

								<span className="form-check-label">
									<T id="domains.http3-support" />
								</span>
							</label>
						)}
					</Field>
				</div>
			</div>
			<div className="row">
				<div className="col-6">
					<Field name="hstsEnabled">
						{({ field }) => (
							<label className="form-check form-switch mt-1">
								<input
									className={hstsEnabled ? toggleEnabled : toggleClasses}
									type="checkbox"
									checked={hstsEnabled}
									onChange={(e) => handleToggleChange(e, field.name)}
									disabled={!hasCertificate || !sslForced}
								/>

								<span className="form-check-label">
									<T id="host.flags.hsts-enabled" />
								</span>
							</label>
						)}
					</Field>
				</div>
				<div className="col-6">
					<Field name="hstsSubdomains">
						{({ field }) => (
							<label className="form-check form-switch mt-1">
								<input
									className={hstsSubdomains ? toggleEnabled : toggleClasses}
									type="checkbox"
									checked={hstsSubdomains}
									onChange={(e) => handleToggleChange(e, field.name)}
									disabled={!hasCertificate || !hstsEnabled}
								/>

								<span className="form-check-label">
									<T id="host.flags.hsts-subdomains" />
								</span>
							</label>
						)}
					</Field>
				</div>
			</div>
		</div>
	);

	return (
		<div>
			<div className="row">
				<div className="col-6">
					<Field name="npmproMtlsVerifyClientOptional">
						{({ field }) => (
							<label className="form-check form-switch mt-1">
								<input
									className={npmproMtlsVerifyClientOptional ? toggleEnabled : toggleClasses}
									type="checkbox"
									checked={npmproMtlsVerifyClientOptional}
									onChange={(e) => handleToggleChange(e, field.name)}
									disabled={!(v?.certificateId > 0 && npmproMtlsCertificateId > 0)}
								/>

								<span className="form-check-label">
									<T id="domains.mtls-verify-client-optional" />
								</span>
							</label>
						)}
					</Field>
				</div>
				{forProxyHost ? (
					<div className="col-6">
						<Field name="npmproMtlsBypassAuthRequest">
							{({ field }) => (
								<label className="form-check form-switch mt-1">
									<input
										className={
											npmproMtlsBypassAuthRequest === true && mtlsBypassAuthRequestPossible
												? toggleEnabled
												: toggleClasses
										}
										type="checkbox"
										checked={npmproMtlsBypassAuthRequest === true && mtlsBypassAuthRequestPossible}
										onChange={(e) => handleToggleChange(e, field.name)}
										disabled={!mtlsBypassAuthRequestPossible}
									/>

									<span className="form-check-label">
										<T id="domains.mtls-bypass-auth-request" />
									</span>
								</label>
							)}
						</Field>
					</div>
				) : null}
			</div>
			{forHttp ? getHttpOptions() : null}
			{newCertificate ? (
				<div className="row">
					<div className="col-6">
						<Field name="npmproReuseKey">
							{({ field }) => (
								<label className="form-check form-switch mt-1">
									<input
										className={reuseKey ? toggleEnabled : toggleClasses}
										type="checkbox"
										checked={Boolean(reuseKey)}
										onChange={(e) => handleToggleChange(e, field.name)}
									/>

									<span className="form-check-label">
										<T id="domains.reuse-key" />
									</span>
								</label>
							)}
						</Field>
					</div>
					<div className="col-6">
						<Field name="npmproDnsChallenge">
							{({ field }) => (
								<label className="form-check form-switch mt-1">
									<input
										className={dnsChallenge ? toggleEnabled : toggleClasses}
										type="checkbox"
										checked={!forHttp || Boolean(dnsChallenge)}
										onChange={(e) => handleToggleChange(e, field.name)}
										disabled={!forHttp}
									/>

									<span className="form-check-label">
										<T id="domains.use-dns" />
									</span>
								</label>
							)}
						</Field>
					</div>
					{forHttp ? null : (
						<DomainNamesField isWildcardPermitted dnsProviderWildcardSupported forCertificate />
					)}
					{dnsChallenge ? <DNSProviderFields showBoundaryBox /> : null}
				</div>
			) : null}
		</div>
	);
}
