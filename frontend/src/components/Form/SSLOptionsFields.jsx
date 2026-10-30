import { Field, useFormikContext } from "formik";
import { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { DNSProviderFields, DomainNamesField, SwitchField } from "src/components";
import { T } from "src/locale";
import { applyChanges } from "src/modules/HookForm";
import { domainNamesOptions, hiddenTlsFields, tlsChanges } from "src/modules/HostForms";
import { namedLocations } from "src/modules/ProxyHostForms";
import { useRecheckDependent } from "./HookForm";

/**
 * A change on the TLS tab of a React Hook Form host window: sets the field and what it turns off or on
 * (HostForms.js tlsChanges), drops the messages of the fields it hides, and re-checks the domain names, whose rule
 * follows the certificate and the DNS challenge
 *
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]  false for a stream
 * @returns {Function} (name, value) => void
 */
export function useTlsChange({ forHttp = true } = {}) {
	const { getValues, setValue, clearErrors } = useFormContext();
	const recheckDomainNames = useRecheckDependent("domainNames");
	return (name, value) => {
		const values = getValues();
		const changes = tlsChanges(values, name, value, { forHttp });
		applyChanges(setValue, changes);
		clearErrors(hiddenTlsFields({ ...values, ...changes }, { forHttp }));
		if ("certificateId" in changes || "npmproDnsChallenge" in changes) recheckDomainNames();
	};
}

const TLS_FIELDS = [
	"certificateId",
	"sslForced",
	"npmproHttp3Support",
	"hstsEnabled",
	"hstsSubdomains",
	"npmproDnsChallenge",
	"npmproReuseKey",
	"npmproMtlsCertificateId",
	"npmproMtlsVerifyClientOptional",
	"npmproMtlsBypassAuthRequest",
	"npmproAuthRequest",
	"locations",
];

// in a React Hook Form form: the switches show the form's values, a change goes through useTlsChange
function HookFormSSLOptionsFields({ forHttp, forProxyHost }) {
	const [
		certificateId,
		sslForced,
		npmproHttp3Support,
		hstsEnabled,
		hstsSubdomains,
		dnsChallenge,
		reuseKey,
		npmproMtlsCertificateId,
		npmproMtlsVerifyClientOptional,
		npmproMtlsBypassAuthRequest,
		npmproAuthRequest,
		locations,
	] = useWatch({ name: TLS_FIELDS });
	const applyTlsChange = useTlsChange({ forHttp });
	const toggle = (name) => (e) => applyTlsChange(name, e.target.checked);

	const newCertificate = certificateId === "new";
	const hasCertificate = newCertificate || certificateId > 0;
	const mtlsBypassAuthRequestPossible =
		npmproMtlsVerifyClientOptional &&
		[{ npmproAuthRequest }, ...namedLocations(locations ?? [])].some(
			({ npmproAuthRequest: authRequest = "none" }) => authRequest !== "none",
		);
	const mtlsRequired = npmproMtlsCertificateId > 0 && !npmproMtlsVerifyClientOptional;

	return (
		<div>
			<div className="divide-y">
				<SwitchField
					id="npmproMtlsVerifyClientOptional"
					label={<T id="domains.mtls-verify-client-optional" />}
					checked={npmproMtlsVerifyClientOptional}
					onChange={toggle("npmproMtlsVerifyClientOptional")}
					disabled={!(certificateId > 0 && npmproMtlsCertificateId > 0)}
				/>
				{forProxyHost ? (
					<SwitchField
						id="npmproMtlsBypassAuthRequest"
						label={<T id="domains.mtls-bypass-auth-request" />}
						checked={npmproMtlsBypassAuthRequest === true && mtlsBypassAuthRequestPossible}
						onChange={toggle("npmproMtlsBypassAuthRequest")}
						disabled={!mtlsBypassAuthRequestPossible}
					/>
				) : null}
				{forHttp ? (
					<>
						<SwitchField
							id="sslForced"
							label={<T id="domains.force-ssl" />}
							checked={sslForced}
							onChange={toggle("sslForced")}
							disabled={!hasCertificate || mtlsRequired}
						/>
						<SwitchField
							id="npmproHttp3Support"
							label={<T id="domains.http3-support" />}
							checked={npmproHttp3Support}
							onChange={toggle("npmproHttp3Support")}
							disabled={!hasCertificate}
						/>
						<SwitchField
							id="hstsEnabled"
							label={<T id="host.flags.hsts-enabled" />}
							checked={hstsEnabled}
							onChange={toggle("hstsEnabled")}
							disabled={!hasCertificate || !sslForced}
						/>
						<SwitchField
							id="hstsSubdomains"
							label={<T id="host.flags.hsts-subdomains" />}
							checked={hstsSubdomains}
							onChange={toggle("hstsSubdomains")}
							disabled={!hasCertificate || !hstsEnabled}
						/>
					</>
				) : null}
				{newCertificate ? (
					<>
						<SwitchField
							id="npmproReuseKey"
							label={<T id="domains.reuse-key" />}
							checked={Boolean(reuseKey)}
							onChange={toggle("npmproReuseKey")}
						/>
						<SwitchField
							id="npmproDnsChallenge"
							label={<T id="domains.use-dns" />}
							checked={!forHttp || Boolean(dnsChallenge)}
							onChange={toggle("npmproDnsChallenge")}
							disabled={!forHttp}
						/>
					</>
				) : null}
			</div>
			{newCertificate && !forHttp ? <DomainNamesField {...domainNamesOptions({}, { forHttp })} /> : null}
			{newCertificate && dnsChallenge ? <DNSProviderFields showBoundaryBox /> : null}
		</div>
	);
}

// in a Formik form (the proxy host window until Task 8)
function FormikSSLOptionsFields({ forHttp, forProxyHost }) {
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

/**
 * The TLS options of a host window: mTLS, HTTPS options (HTTP hosts), and for a requested certificate its key, the
 * DNS challenge (always for a stream, with the certificate's domain names) and the DNS provider fields
 */
export function SSLOptionsFields({ forHttp = true, forProxyHost }) {
	// Task 8 removes the Formik branch
	return useFormContext() ? (
		<HookFormSSLOptionsFields forHttp={forHttp} forProxyHost={forProxyHost} />
	) : (
		<FormikSSLOptionsFields forHttp={forHttp} forProxyHost={forProxyHost} />
	);
}
