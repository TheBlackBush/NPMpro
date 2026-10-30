import { IconShield } from "@tabler/icons-react";
import { useController, useWatch } from "react-hook-form";
import Select, { components } from "react-select";
import { certificateProviderTranslation } from "src/components";
import { ApiErrorContent } from "src/components/ErrorAlert";
import { useCertificates, useUser } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { CERTIFICATES, hasPermission, MANAGE } from "src/modules/Permissions";
import { selectClassNames } from "src/modules/Select";
import { useTlsChange } from "./SSLOptionsFields";

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

/**
 * The certificate of a host and its mTLS CA certificate (the fields certificateId and npmproMtlsCertificateId, the
 * names tlsChanges works on): two controllers. A choice sets the field, then turns off what it rules out (no
 * certificate: no HTTPS options and no mTLS; another certificate than a requested one: no request fields).
 */
export function SSLCertificateField({ label, allowNew, forHttp = true, mtlsLabel = "mtls-certificate" }) {
	const { isPending, isError, error, data } = useCertificates();
	const { data: user } = useUser("me");
	const { field } = useController({ name: CERTIFICATE });
	const { field: mtlsField } = useController({ name: MTLS_CERTIFICATE });
	const udpForwarding = useWatch({ name: "udpForwarding" });
	const applyTlsChange = useTlsChange({ forHttp });

	const options =
		data
			?.filter((cert) => cert.provider !== "mtls")
			.map((cert) => ({
				value: cert.id,
				label: cert.niceName,
				subLabel: `${intl.formatMessage({ id: certificateProviderTranslation(cert.provider) })} \u2014 ${intl.formatMessage({ id: "expires.on" }, { date: formatDateTime(cert.expiresOn) })}`,
				icon: <IconShield size={14} className="text-pink" />,
			})) || [];

	const mtlsOptions =
		data
			?.filter((cert) => cert.provider === "mtls")
			.map((cert) => ({
				value: cert.id,
				label: cert.niceName,
				subLabel: `${intl.formatMessage({ id: certificateProviderTranslation(cert.provider) })} \u2014 ${intl.formatMessage({ id: "expires.on" }, { date: formatDateTime(cert.expiresOn) })}`,
				icon: <IconShield size={14} className="text-pink" />,
			})) || [];

	// Prepend the Add New option
	if (allowNew && hasPermission(CERTIFICATES, MANAGE, user?.permissions, user?.roles)) {
		options?.unshift({
			value: "new",
			label: intl.formatMessage({ id: "certificates.request.title" }),
			subLabel: intl.formatMessage({ id: "certificates.request.subtitle" }),
			icon: <IconShield size={14} className="text-lime" />,
		});
	}

	// Prepend the None option
	options?.unshift({
		value: 0,
		label: intl.formatMessage({ id: "certificate.none.title" }),
		subLabel: forHttp
			? intl.formatMessage({ id: "certificate.none.subtitle.for-http" })
			: intl.formatMessage({ id: "certificate.none.subtitle" }),
		icon: <IconShield size={14} className="text-red" />,
	});

	mtlsOptions?.unshift({
		value: 0,
		label: intl.formatMessage({ id: "certificate.none.title" }),
		subLabel: intl.formatMessage({ id: "certificate.none.subtitle" }),
		icon: <IconShield size={14} className="text-red" />,
	});

	return (
		<>
			<div className="mb-3">
				<label className="form-label" htmlFor={CERTIFICATE}>
					<T id={label} />
				</label>
				{isPending ? <div className="placeholder placeholder-lg col-12 my-3 placeholder-glow" /> : null}
				{isError ? (
					<div className="invalid-feedback d-block">
						<ApiErrorContent error={error} />
					</div>
				) : null}
				{!isPending && !isError ? (
					<Select
						inputId={CERTIFICATE}
						unstyled
						classNames={selectClassNames}
						value={
							options.find((o) => o.value === field.value) ??
							(field.value ? { value: field.value, label: `#${field.value}` } : options[0])
						}
						options={options}
						components={{ Option }}
						styles={{
							option: (base) => ({
								...base,
								height: "100%",
							}),
						}}
						ref={field.ref}
						onChange={(newValue) => {
							field.onChange(newValue?.value);
							applyTlsChange(CERTIFICATE, newValue?.value);
						}}
						onBlur={field.onBlur}
						isDisabled={udpForwarding}
					/>
				) : null}
			</div>
			<div className="mb-3">
				<label className="form-label" htmlFor="mtlsCertificate">
					<T id={mtlsLabel} />
				</label>
				{isPending ? <div className="placeholder placeholder-lg col-12 my-3 placeholder-glow" /> : null}
				{isError ? (
					<div className="invalid-feedback d-block">
						<ApiErrorContent error={error} />
					</div>
				) : null}
				{!isPending && !isError ? (
					<Select
						inputId="mtlsCertificate"
						unstyled
						classNames={selectClassNames}
						value={
							mtlsOptions.find((o) => o.value === mtlsField.value) ??
							(mtlsField.value
								? { value: mtlsField.value, label: `#${mtlsField.value}` }
								: mtlsOptions[0])
						}
						options={mtlsOptions}
						components={{ Option }}
						styles={{
							option: (base) => ({
								...base,
								height: "100%",
							}),
						}}
						ref={mtlsField.ref}
						onChange={(newValue) => {
							mtlsField.onChange(newValue?.value);
							applyTlsChange(MTLS_CERTIFICATE, newValue?.value);
						}}
						onBlur={mtlsField.onBlur}
						isDisabled={udpForwarding || !(field.value > 0)}
					/>
				) : null}
			</div>
		</>
	);
}
