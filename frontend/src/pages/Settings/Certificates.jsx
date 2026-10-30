import { useFormContext, useWatch } from "react-hook-form";
import { useCertificates } from "src/hooks";
import { intl, T } from "src/locale";
import { defaultKeySize, isServableCertificate, keySizeOptions } from "src/modules/RuntimeSettings";
import { certificatesValidate, ECH, RENEWAL } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { RuntimeNumber, RuntimeSelect, RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { Part, RuntimeSection, useRuntimeSection } from "./Runtime/RuntimeSection";

const toForm = (data) => ({
	keyType: data.keyType,
	keySize: data.keySize,
	profile: data.profile ?? "",
	mustStaple: Boolean(data.mustStaple),
	serverTlsVerify: Boolean(data.serverTlsVerify),
	renewalInterval: String(data.renewalInterval),
	ocspStapling: Boolean(data.ocspStapling),
	customOcspStapling: Boolean(data.customOcspStapling),
	defaultCertificateId: String(data.defaultCertificateId ?? 0),
	echRotationInterval: String(data.echRotationInterval),
});

const toApi = (values) => ({
	...values,
	profile: values.profile.trim(),
	renewalInterval: Number(values.renewalInterval),
	// must-staple certificates need OCSP stapling (the backend forces it on as well)
	ocspStapling: values.mustStaple || values.ocspStapling,
	defaultCertificateId: Number(values.defaultCertificateId),
	echRotationInterval: Number(values.echRotationInterval),
});

const validate = certificatesValidate(validations);

function RequestFields() {
	const { getValues, setValue } = useFormContext();
	const keyType = useWatch({ name: "keyType" });
	const { isLocked } = useRuntimeSection();
	const keyTypes = ["ecdsa", "rsa"].map((value) => ({
		value,
		label: intl.formatMessage({ id: `settings.certificates.key-type.${value}` }),
	}));
	const sizes = keySizeOptions(keyType).map((value) => ({ value, label: value }));
	// the key size follows the key type (a locked size stays as the environment sets it)
	const onKeyType = (next) => {
		if (!(isLocked("keySize") || keySizeOptions(next).includes(getValues("keySize")))) {
			setValue("keySize", defaultKeySize(next), { shouldDirty: true });
		}
	};
	return (
		<Part titleId="settings.certificates.requests">
			<RuntimeSelect
				name="keyType"
				label={<T id="settings.certificates.key-type" />}
				hint={<T id="settings.certificates.key-type.hint" />}
				options={keyTypes}
				onChange={onKeyType}
			/>
			<RuntimeSelect
				name="keySize"
				label={<T id="settings.certificates.key-size" />}
				hint={<T id="settings.certificates.key-size.hint" />}
				options={sizes}
			/>
			<RuntimeText
				name="profile"
				label={<T id="settings.certificates.profile" />}
				hint={<T id="settings.certificates.profile.hint" />}
				placeholder={intl.formatMessage({ id: "settings.certificates.profile.placeholder" })}
			/>
			<RuntimeSwitch
				name="mustStaple"
				label={<T id="settings.certificates.must-staple" />}
				hint={<T id="settings.certificates.must-staple.hint" />}
			/>
			<RuntimeSwitch
				name="serverTlsVerify"
				className=""
				label={<T id="settings.certificates.server-tls-verify" />}
				hint={<T id="settings.certificates.server-tls-verify.hint" />}
			/>
		</Part>
	);
}

function StaplingFields() {
	const mustStaple = useWatch({ name: "mustStaple" });
	const { isLocked } = useRuntimeSection();
	// must-staple forces OCSP stapling on, unless the environment sets stapling itself
	const forced = mustStaple && !isLocked("ocspStapling");
	return (
		<Part titleId="settings.certificates.stapling">
			<RuntimeSwitch
				name="ocspStapling"
				forced={forced}
				label={<T id="settings.certificates.ocsp-stapling" />}
				hint={
					<>
						<T id="settings.certificates.ocsp-stapling.hint" />
						{forced ? (
							<span className="d-block">
								<T id="settings.certificates.ocsp-stapling.forced" />
							</span>
						) : null}
					</>
				}
			/>
			<RuntimeSwitch
				name="customOcspStapling"
				className=""
				label={<T id="settings.certificates.custom-ocsp-stapling" />}
				hint={<T id="settings.certificates.custom-ocsp-stapling.hint" />}
			/>
		</Part>
	);
}

function DefaultCertificateField() {
	const defaultCertificateId = useWatch({ name: "defaultCertificateId" });
	const { data, isError } = useCertificates();
	const options = [
		{ value: "0", label: intl.formatMessage({ id: "settings.certificates.default-certificate.builtin" }) },
	];
	for (const cert of data ?? []) {
		// only certificates the backend accepts as default (no mTLS CA, files present)
		if (isServableCertificate(cert)) options.push({ value: String(cert.id), label: cert.niceName });
	}
	// the stored certificate while the list loads, failed to load or no longer lists it
	if (!options.some((option) => option.value === defaultCertificateId)) {
		options.push({
			value: defaultCertificateId,
			label: intl.formatMessage(
				{ id: "settings.certificates.default-certificate.unknown" },
				{ id: defaultCertificateId },
			),
		});
	}
	return (
		<Part titleId="settings.certificates.default-certificate">
			<RuntimeSelect
				name="defaultCertificateId"
				narrow={false}
				label={<T id="settings.certificates.default-certificate.label" />}
				hint={
					<>
						<T id="settings.certificates.default-certificate.hint" />
						{isError ? (
							<span className="d-block text-danger">
								<T id="settings.certificates.default-certificate.list-error" />
							</span>
						) : null}
					</>
				}
				options={options}
			/>
		</Part>
	);
}

function Fields() {
	return (
		<>
			<RequestFields />
			<Part titleId="settings.certificates.renewal">
				<RuntimeNumber
					name="renewalInterval"
					label={<T id="settings.certificates.renewal-interval" />}
					hint={<T id="settings.certificates.renewal-interval.hint" data={RENEWAL} />}
					unit={<T id="settings.runtime.hours" />}
					{...RENEWAL}
				/>
			</Part>
			<StaplingFields />
			<DefaultCertificateField />
			<Part titleId="settings.certificates.ech" last>
				<RuntimeNumber
					name="echRotationInterval"
					label={<T id="settings.certificates.ech-interval" />}
					hint={<T id="settings.certificates.ech-interval.hint" data={ECH} />}
					unit={<T id="settings.runtime.hours" />}
					{...ECH}
				/>
			</Part>
		</>
	);
}

export default function Certificates() {
	return (
		<RuntimeSection
			group="certificates"
			titleId="settings.certificates"
			toForm={toForm}
			toApi={toApi}
			validate={validate}
		>
			<Fields />
		</RuntimeSection>
	);
}
