import { useFormikContext } from "formik";
import { useCertificates } from "src/hooks";
import { intl, T } from "src/locale";
import { defaultKeySize, isServableCertificate, keySizeOptions } from "src/modules/RuntimeSettings";
import { RuntimeNumber, RuntimeSelect, RuntimeSwitch, RuntimeText } from "./Runtime/fields";
import { Part, RuntimeSection, useRuntimeSection } from "./Runtime/RuntimeSection";

const RENEWAL = { min: 1, max: 499 };
const ECH = { min: 1, max: 24 };
const PROFILE = /^[A-Za-z0-9._-]{0,64}$/u;

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

const rangeError = (value, { min, max }) => {
	const n = Number(value);
	return Number.isInteger(n) && n >= min && n <= max
		? null
		: intl.formatMessage({ id: "settings.runtime.number.invalid" }, { min, max });
};

const validate = (values) => {
	const errors = {};
	const renewal = rangeError(values.renewalInterval, RENEWAL);
	if (renewal) errors.renewalInterval = renewal;
	const ech = rangeError(values.echRotationInterval, ECH);
	if (ech) errors.echRotationInterval = ech;
	if (!PROFILE.test(values.profile.trim())) {
		errors.profile = intl.formatMessage({ id: "settings.certificates.profile.invalid" });
	}
	return errors;
};

function RequestFields() {
	const { values, setFieldValue } = useFormikContext();
	const { isLocked } = useRuntimeSection();
	const keyTypes = ["ecdsa", "rsa"].map((value) => ({
		value,
		label: intl.formatMessage({ id: `settings.certificates.key-type.${value}` }),
	}));
	const sizes = keySizeOptions(values.keyType).map((value) => ({ value, label: value }));
	const onKeyType = (keyType) => {
		void setFieldValue("keyType", keyType);
		// the key size follows the key type (a locked size stays as the environment sets it)
		if (!(isLocked("keySize") || keySizeOptions(keyType).includes(values.keySize))) {
			void setFieldValue("keySize", defaultKeySize(keyType));
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
	const { values } = useFormikContext();
	const { isLocked } = useRuntimeSection();
	// must-staple forces OCSP stapling on, unless the environment sets stapling itself
	const forced = values.mustStaple && !isLocked("ocspStapling");
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
	const { values } = useFormikContext();
	const { data, isError } = useCertificates();
	const options = [
		{ value: "0", label: intl.formatMessage({ id: "settings.certificates.default-certificate.builtin" }) },
	];
	for (const cert of data ?? []) {
		// only certificates the backend accepts as default (no mTLS CA, files present)
		if (isServableCertificate(cert)) options.push({ value: String(cert.id), label: cert.niceName });
	}
	// the stored certificate while the list loads, failed to load or no longer lists it
	if (!options.some((option) => option.value === values.defaultCertificateId)) {
		options.push({
			value: values.defaultCertificateId,
			label: intl.formatMessage(
				{ id: "settings.certificates.default-certificate.unknown" },
				{ id: values.defaultCertificateId },
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
