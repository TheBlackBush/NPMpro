import { useController } from "react-hook-form";
import CreatableSelect from "react-select/creatable";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { validateDomain } from "src/modules/Validations";

// the label, the chips select and the hints or the error
function DomainNamesControl({
	name,
	id,
	label,
	isValidDomain,
	helperTexts,
	value,
	error,
	onChange,
	onBlur,
	selectRef,
}) {
	// a domain already in the list is not offered again
	const isValidNewOption = (input, selected) =>
		isValidDomain(input) && !selected.some(({ value: v }) => v.toLowerCase() === input.trim().toLowerCase());
	return (
		<div className="mb-3">
			<label className="form-label" htmlFor={id}>
				<T id={label} />
			</label>
			<CreatableSelect
				ref={selectRef}
				unstyled
				classNames={selectClassNames}
				name={name}
				inputId={id}
				closeMenuOnSelect={true}
				isClearable={false}
				isValidNewOption={isValidNewOption}
				isMulti
				required
				aria-invalid={error ? "true" : undefined}
				onBlur={onBlur}
				placeholder={intl.formatMessage({ id: "domain-names.placeholder" })}
				onChange={(v) => onChange([...new Set(v?.map((i) => i.value.trim()))])}
				value={value?.map((d) => ({ label: d, value: d }))}
			/>

			{error ? (
				<div className="invalid-feedback d-block">{error}</div>
			) : helperTexts.length ? (
				helperTexts.map((i, idx) => (
					<div key={idx} className="form-hint">
						{i}
					</div>
				))
			) : null}
		</div>
	);
}

// in a React Hook Form form: the form's resolver checks it (CertificateForms.js), an error shows as it is held
function HookFormDomainNames({ control, onChange }) {
	const { field, fieldState } = useController({ name: control.name });
	return (
		<DomainNamesControl
			{...control}
			value={field.value}
			error={fieldState.error?.message ?? null}
			onChange={(doms) => {
				field.onChange(doms);
				onChange?.(doms);
			}}
			onBlur={field.onBlur}
			selectRef={field.ref}
		/>
	);
}

export function DomainNamesField({
	name = "domainNames",
	label = "domain-names",
	id = "domainNames",
	isWildcardPermitted,
	dnsProviderWildcardSupported,
	forCertificate,
	onChange,
}) {
	const helperTexts = [];
	if (!isWildcardPermitted) {
		helperTexts.push(<T id="domain-names.wildcards-not-permitted" />);
	} else if (!dnsProviderWildcardSupported) {
		helperTexts.push(<T id="domain-names.wildcards-not-supported" />);
	}
	const control = {
		name,
		id,
		label,
		helperTexts,
		isValidDomain: validateDomain(isWildcardPermitted && dnsProviderWildcardSupported, forCertificate),
	};
	return <HookFormDomainNames control={control} onChange={onChange} />;
}
