import { useController } from "react-hook-form";
import CreatableSelect from "react-select/creatable";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { validateDomain } from "src/modules/Validations";
import { FormField, selectControlProps } from "./FormField";

/**
 * The domain names of the form around it: the label (required), the chips select, the error and the hint about
 * wildcards. The form's resolver checks the list (domainNamesRule); onChange(domains) runs after the field took the
 * new list.
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
	let hint = null;
	if (!isWildcardPermitted) {
		hint = <T id="domain-names.wildcards-not-permitted" />;
	} else if (!dnsProviderWildcardSupported) {
		hint = <T id="domain-names.wildcards-not-supported" />;
	}
	const isValidDomain = validateDomain(isWildcardPermitted && dnsProviderWildcardSupported, forCertificate);
	// a domain already in the list is not offered again
	const isValidNewOption = (input, selected) =>
		isValidDomain(input) && !selected.some(({ value: v }) => v.toLowerCase() === input.trim().toLowerCase());
	return (
		<FormField id={id} label={<T id={label} />} required hint={hint} error={error}>
			{(control) => (
				<CreatableSelect
					{...selectControlProps(control)}
					ref={field.ref}
					unstyled
					classNames={selectClassNames}
					name={name}
					closeMenuOnSelect={true}
					isClearable={false}
					isValidNewOption={isValidNewOption}
					isMulti
					required
					onBlur={field.onBlur}
					placeholder={intl.formatMessage({ id: "domain-names.placeholder" })}
					onChange={(v) => {
						const domains = [...new Set(v?.map((i) => i.value.trim()))];
						field.onChange(domains);
						onChange?.(domains);
					}}
					value={field.value?.map((d) => ({ label: d, value: d }))}
				/>
			)}
		</FormField>
	);
}
