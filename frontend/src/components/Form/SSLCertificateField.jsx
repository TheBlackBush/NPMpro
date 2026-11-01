import { IconShield } from "@tabler/icons-react";
import { memo } from "react";
import { useController, useWatch } from "react-hook-form";
import Select, { components } from "react-select";
import { certificateProviderTranslation } from "src/components";
import { ApiErrorContent } from "src/components/ErrorAlert";
import { useCertificates, useUser } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { CERTIFICATES, hasPermission, MANAGE } from "src/modules/Permissions";
import { selectClassNames } from "src/modules/Select";
import { FormField, selectControlProps } from "./FormField";
import { useReadOnly } from "./HookForm";
import { useTlsChange } from "./useTlsChange";

// the fields of the certificate and of the mTLS CA certificate (HostForms.js tlsChanges works on these names)
const CERTIFICATE = "certificateId";
const MTLS_CERTIFICATE = "npmproMtlsCertificateId";

const Option = (props) => (
	<components.Option {...props}>
		<div className="flex-fill">
			<div className="fw-medium">
				{props.data.icon} <strong>{props.data.label}</strong>
			</div>
			<div className="text-secondary mt-1 ps-3">{props.data.subLabel}</div>
		</div>
	</components.Option>
);

const optionStyles = { option: (base) => ({ ...base, height: "100%" }) };

const certificateOption = (cert) => ({
	value: cert.id,
	label: cert.niceName,
	subLabel: `${intl.formatMessage({ id: certificateProviderTranslation(cert.provider) })} \u2014 ${intl.formatMessage({ id: "expires.on" }, { date: formatDateTime(cert.expiresOn) })}`,
	icon: <IconShield size={14} className="text-pink" />,
});

const noneOption = (subtitle) => ({
	value: 0,
	label: intl.formatMessage({ id: "certificate.none.title" }),
	subLabel: intl.formatMessage({ id: subtitle }),
	icon: <IconShield size={14} className="text-red" />,
});

// a certificate select on FormField: the placeholder while the certificates load, their error, or the select
function CertificateSelect({ id, label, hint, field, options, disabled, onChoose }) {
	const { isPending, isError, error } = useCertificates();
	const readOnly = useReadOnly();
	return (
		<FormField id={id} label={<T id={label} />} hint={hint}>
			{(control) => (
				<>
					{isPending ? <div className="placeholder placeholder-lg col-12 my-3 placeholder-glow" /> : null}
					{isError ? (
						<div className="invalid-feedback d-block">
							<ApiErrorContent error={error} />
						</div>
					) : null}
					{!isPending && !isError ? (
						<Select
							{...selectControlProps(control, { Option })}
							unstyled
							classNames={selectClassNames}
							value={
								options.find((o) => o.value === field.value) ??
								(field.value ? { value: field.value, label: `#${field.value}` } : options[0])
							}
							options={options}
							styles={optionStyles}
							ref={field.ref}
							onChange={(newValue) => {
								field.onChange(newValue?.value);
								onChoose(newValue?.value);
							}}
							onBlur={field.onBlur}
							isDisabled={readOnly || disabled}
						/>
					) : null}
				</>
			)}
		</FormField>
	);
}

/**
 * The certificate of a host (the field certificateId, a controller): None, a requested one (with the permission to
 * manage certificates) or an existing one. A choice sets the field, then turns off what it rules out (no
 * certificate: no HTTPS options and no mTLS; another certificate than a requested one: no request fields).
 */
export function SSLCertificateField({ label, allowNew, forHttp = true }) {
	const { data } = useCertificates();
	const { data: user } = useUser("me");
	const { field } = useController({ name: CERTIFICATE });
	const udpForwarding = useWatch({ name: "udpForwarding" });
	const applyTlsChange = useTlsChange({ forHttp });

	const options = [
		noneOption(forHttp ? "certificate.none.subtitle.for-http" : "certificate.none.subtitle"),
		...(allowNew && hasPermission(CERTIFICATES, MANAGE, user?.permissions, user?.roles)
			? [
					{
						value: "new",
						label: intl.formatMessage({ id: "certificates.request.title" }),
						subLabel: intl.formatMessage({ id: "certificates.request.subtitle" }),
						icon: <IconShield size={14} className="text-lime" />,
					},
				]
			: []),
		...(data ?? []).filter((cert) => cert.provider !== "mtls").map(certificateOption),
	];

	return (
		<CertificateSelect
			id={CERTIFICATE}
			label={label}
			field={field}
			options={options}
			disabled={udpForwarding}
			onChoose={(value) => applyTlsChange(CERTIFICATE, value)}
		/>
	);
}

/**
 * The mTLS CA certificate of a host (the field npmproMtlsCertificateId, a controller), directly under the certificate
 * select (SSLOptionsFields renders it). reason is the TLS rule that turns it off (TlsOptions.js tlsDisabledReasons, a constant object): the hint says
 * why. A memo component, so a change elsewhere on the TLS tab (a location path) does not render the select again.
 */
export const MtlsCertificateField = memo(({ forHttp = true, label = "mtls-certificate", reason }) => {
	const { data } = useCertificates();
	const { field } = useController({ name: MTLS_CERTIFICATE });
	const udpForwarding = useWatch({ name: "udpForwarding" });
	const applyTlsChange = useTlsChange({ forHttp });

	const options = [
		noneOption("certificate.none.subtitle"),
		...(data ?? []).filter((cert) => cert.provider === "mtls").map(certificateOption),
	];

	return (
		<CertificateSelect
			id="mtlsCertificate"
			label={label}
			hint={reason ? <T id={reason.id} tData={reason.tData} /> : undefined}
			field={field}
			options={options}
			disabled={udpForwarding || Boolean(reason)}
			onChoose={(value) => applyTlsChange(MTLS_CERTIFICATE, value)}
		/>
	);
});
