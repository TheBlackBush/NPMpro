import { useFormContext, useWatch } from "react-hook-form";
import { useAcmeProfiles, useAcmeSettings, useCertificates } from "src/hooks";
import { intl, T } from "src/locale";
import { profileChoices } from "src/modules/AcmeAccount";
import { defaultKeySize, isServableCertificate, keySizeOptions } from "src/modules/RuntimeSettings";
import { certificatesValidate, ECH, RENEWAL } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import AcmeAccountCard from "./AcmeAccountCard";
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

const profileLabel = (option) => {
	if (option.labelId) return intl.formatMessage({ id: option.labelId });
	if (option.missing)
		return intl.formatMessage({ id: "settings.certificates.profile.missing" }, { name: option.label });
	return option.label;
};

const profileOption = (option) => ({
	value: option.value,
	label: profileLabel(option),
	description: option.description,
});

/**
 * The profile: a select of what the instance CA offers, the stored value kept even when the CA no longer lists it
 * (opening the page never changes it); a text field when the CA's list cannot be read
 */
function ProfileField() {
	const { data: acme } = useAcmeSettings();
	const server = acme?.server;
	const profiles = useAcmeProfiles(server, { enabled: Boolean(server) });
	const stored = useWatch({ name: "profile" });
	const label = <T id="settings.certificates.profile" />;
	const hint = <T id="settings.certificates.profile.hint" />;
	if (!server || profiles.isPending) {
		// while the list loads: the default and the stored value, no text field that turns into a select
		const options = [{ value: "", labelId: "settings.certificates.profile.placeholder" }];
		if (stored) options.push({ value: stored, label: stored });
		return <RuntimeSelect name="profile" label={label} hint={hint} options={options.map(profileOption)} />;
	}
	const choices = profileChoices({ result: profiles.data, stored });
	if (choices.mode === "select") {
		return <RuntimeSelect name="profile" label={label} hint={hint} options={choices.options.map(profileOption)} />;
	}
	return (
		<RuntimeText
			name="profile"
			label={label}
			hint={
				<>
					{hint} <T id="settings.certificates.profile.text-note" />
				</>
			}
			placeholder={intl.formatMessage({ id: "settings.certificates.profile.placeholder" })}
		/>
	);
}

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
		<Part titleId="settings.certificates.requests" infoId="settings.certificates.requests.description">
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
			<ProfileField />
			<RuntimeSwitch
				name="mustStaple"
				label={<T id="settings.certificates.must-staple" />}
				hint={<T id="settings.certificates.must-staple.hint" />}
			/>
			<RuntimeSwitch
				name="serverTlsVerify"
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
		<Part titleId="settings.certificates.stapling" infoId="settings.certificates.stapling.description">
			<RuntimeSwitch
				name="ocspStapling"
				forced={forced}
				label={<T id="settings.certificates.ocsp-stapling" />}
				hint={
					<>
						<T id="settings.certificates.ocsp-stapling.hint" />
						{forced ? (
							<span className="block">
								<T id="settings.certificates.ocsp-stapling.forced" />
							</span>
						) : null}
					</>
				}
			/>
			<RuntimeSwitch
				name="customOcspStapling"
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
		<Part
			titleId="settings.certificates.default-certificate"
			infoId="settings.certificates.default-certificate.description"
		>
			<RuntimeSelect
				name="defaultCertificateId"
				layout="block"
				label={<T id="settings.certificates.default-certificate.label" />}
				hint={
					<>
						<T id="settings.certificates.default-certificate.hint" />
						{isError ? (
							<span className="block text-destructive">
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
			<Part titleId="settings.certificates.renewal" infoId="settings.certificates.renewal.description">
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
			<Part titleId="settings.certificates.ech" infoId="settings.certificates.ech.description">
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
			leadId="settings.certificates.intro"
			top={<AcmeAccountCard />}
			toForm={toForm}
			toApi={toApi}
			validate={validate}
		>
			<Fields />
		</RuntimeSection>
	);
}
