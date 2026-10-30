import { useController } from "react-hook-form";
import CreatableSelect from "react-select/creatable";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { validateDomain } from "src/modules/Validations";

/**
 * The domain names of the form around it: the label, the chips select and the hints or the error. The form's
 * resolver checks the list (domainNamesRule); onChange(domains) runs after the field took the new list.
 */
export function DomainNamesField({
	name = "domainNames",
	label = "domain-names",
	id = "domainNames",
	isWildcardPermitted,
	dnsProviderWildcardSupported,
	forCertificate,
	onChange,
}) {
	const { field, fieldState } = useController({ name });
	const error = fieldState.error?.message ?? null;
	const helperTexts = [];
	if (!isWildcardPermitted) {
		helperTexts.push(<T id="domain-names.wildcards-not-permitted" />);
	} else if (!dnsProviderWildcardSupported) {
		helperTexts.push(<T id="domain-names.wildcards-not-supported" />);
	}
	const isValidDomain = validateDomain(isWildcardPermitted && dnsProviderWildcardSupported, forCertificate);
	// a domain already in the list is not offered again
	const isValidNewOption = (input, selected) =>
		isValidDomain(input) && !selected.some(({ value: v }) => v.toLowerCase() === input.trim().toLowerCase());
	return (
		<div className="mb-3">
			<label className="form-label" htmlFor={id}>
				<T id={label} />
			</label>
			<CreatableSelect
				ref={field.ref}
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
				onBlur={field.onBlur}
				placeholder={intl.formatMessage({ id: "domain-names.placeholder" })}
				onChange={(v) => {
					const domains = [...new Set(v?.map((i) => i.value.trim()))];
					field.onChange(domains);
					onChange?.(domains);
				}}
				value={field.value?.map((d) => ({ label: d, value: d }))}
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
