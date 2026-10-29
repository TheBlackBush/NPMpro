import { Field, useFormikContext } from "formik";
import { useController, useFormContext, useWatch } from "react-hook-form";
import Select from "react-select";
import { useDnsProviders } from "src/hooks";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { validateInteger, validateRequired } from "src/modules/Validations";
import { NoticeAlert } from "../NoticeAlert";
import { DnsCredentialSelect } from "./DnsCredentialSelect";

const requiredProvider = validateRequired();
const validPropagation = validateInteger({ min: 0, max: 7200 });

// a field's error once it was left or a submit was tried (Formik)
const shownError = (form, name) => (form.touched[name] || form.submitCount > 0 ? form.errors[name] : null);

function ProviderSelect({ providerId, error, onChange, onBlur, selectRef }) {
	const { data: dnsProviders, isPending } = useDnsProviders();
	// deprecated providers are not offered for new certificates, only kept when already selected
	const options = dnsProviders
		?.filter((p) => !p.deprecated || p.id === providerId)
		.map((p) => ({
			value: p.id,
			label: p.name,
		}));
	return (
		<div className="row">
			<label htmlFor="dnsProvider" className="form-label">
				<T id="certificates.dns.provider" />
			</label>
			<Select
				ref={selectRef}
				unstyled
				classNames={selectClassNames}
				name="npmproDnsProvider"
				inputId="dnsProvider"
				closeMenuOnSelect={true}
				isClearable={false}
				placeholder={intl.formatMessage({
					id: "certificates.dns.provider.placeholder",
				})}
				isLoading={isPending}
				isSearchable
				required
				aria-invalid={error ? "true" : undefined}
				aria-describedby={error ? "dnsProvider-error" : undefined}
				onBlur={onBlur}
				onChange={(newValue) => onChange(newValue?.value)}
				options={options}
			/>
			{error ? (
				<div className="invalid-feedback d-block" id="dnsProvider-error">
					{error}
				</div>
			) : null}
		</div>
	);
}

function PropagationInput({ value, error, onChange, onBlur, inputRef }) {
	return (
		<div className="mt-3">
			<label htmlFor="propagationSeconds" className="form-label">
				<T id="certificates.dns.propagation-seconds" />
			</label>
			<input
				ref={inputRef}
				id="propagationSeconds"
				type="number"
				className={`form-control ${error ? "is-invalid" : ""}`}
				aria-invalid={error ? "true" : undefined}
				min={0}
				max={7200}
				placeholder={intl.formatMessage({
					id: "certificates.dns.propagation-seconds-default",
				})}
				name="npmproPropagationSeconds"
				onBlur={onBlur}
				// 0 means the default of the DNS plugin, shown as an empty field
				value={value || ""}
				onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
			/>
			{error ? <div className="invalid-feedback">{error}</div> : null}
			<small className="text-secondary">
				<T id="certificates.dns.propagation-seconds-note" />
			</small>
		</div>
	);
}

// the notice, the provider and, with a provider, the credential and the propagation time
function DnsProviderLayout({ showBoundaryBox, providerId, provider, propagation }) {
	return (
		<div className={showBoundaryBox ? "py-3 border border-orange border-opacity-10 rounded bg-cyan-lt" : undefined}>
			<NoticeAlert>
				<T id="certificates.dns.warning" />
			</NoticeAlert>
			{provider}
			{providerId ? (
				<>
					<DnsCredentialSelect name="npmproDnsCredentialId" provider={providerId} />
					<p className="mt-2 mb-0">
						<small className="text-secondary">
							<T id="certificates.dns.credentials-saved-note" />
						</small>
					</p>
					{propagation}
				</>
			) : null}
		</div>
	);
}

// in a Formik form: the fields' own validate; shown once left or after a submit
function FormikDnsProviderFields({ showBoundaryBox }) {
	const { values, setFieldValue } = useFormikContext();
	return (
		<DnsProviderLayout
			showBoundaryBox={showBoundaryBox}
			providerId={values.npmproDnsProvider}
			provider={
				<Field name="npmproDnsProvider" validate={requiredProvider}>
					{({ field, form }) => (
						<ProviderSelect
							providerId={values.npmproDnsProvider}
							error={shownError(form, field.name)}
							onBlur={() => form.setFieldTouched(field.name, true)}
							onChange={(value) => {
								void setFieldValue("npmproDnsProvider", value);
								void setFieldValue("npmproDnsCredentialId", undefined);
							}}
						/>
					)}
				</Field>
			}
			propagation={
				<Field name="npmproPropagationSeconds" validate={validPropagation}>
					{({ field, form }) => (
						<PropagationInput
							value={field.value}
							error={shownError(form, field.name)}
							onBlur={field.onBlur}
							onChange={(value) => form.setFieldValue(field.name, value)}
						/>
					)}
				</Field>
			}
		/>
	);
}

function HookFormProvider({ providerId }) {
	const { setValue } = useFormContext();
	// deps: a provider change re-checks the credential (once the provider was left or a save was tried)
	const { field, fieldState } = useController({
		name: "npmproDnsProvider",
		rules: { deps: ["npmproDnsCredentialId"] },
	});
	return (
		<ProviderSelect
			providerId={providerId}
			selectRef={field.ref}
			error={fieldState.error?.message ?? null}
			onBlur={field.onBlur}
			onChange={(value) => {
				// another provider's credential does not fit; cleared before the change, so deps checks the empty one
				setValue("npmproDnsCredentialId", null, { shouldDirty: true });
				field.onChange(value);
			}}
		/>
	);
}

function HookFormPropagation() {
	const { field, fieldState } = useController({ name: "npmproPropagationSeconds" });
	return (
		<PropagationInput
			inputRef={field.ref}
			value={field.value}
			error={fieldState.error?.message ?? null}
			onBlur={field.onBlur}
			onChange={field.onChange}
		/>
	);
}

// in a React Hook Form form: the resolver checks the fields (CertificateForms.js dnsChallengeRules)
function HookFormDnsProviderFields({ showBoundaryBox }) {
	const providerId = useWatch({ name: "npmproDnsProvider" });
	return (
		<DnsProviderLayout
			showBoundaryBox={showBoundaryBox}
			providerId={providerId}
			provider={<HookFormProvider providerId={providerId} />}
			propagation={<HookFormPropagation />}
		/>
	);
}

export function DNSProviderFields({ showBoundaryBox }) {
	// A3 removes the Formik branch
	return useFormContext() ? (
		<HookFormDnsProviderFields showBoundaryBox={showBoundaryBox} />
	) : (
		<FormikDnsProviderFields showBoundaryBox={showBoundaryBox} />
	);
}
