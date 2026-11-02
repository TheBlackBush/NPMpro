import { useController } from "react-hook-form";
import { Combobox } from "src/components/Combobox";
import { intl, T } from "src/locale";
import { validateDomain } from "src/modules/Validations";
import { FormField } from "./FormField";
import { useReadOnly } from "./HookForm";

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
	const readOnly = useReadOnly();
	const error = fieldState.error?.message ?? null;
	let hint = null;
	if (!isWildcardPermitted) {
		hint = <T id="domain-names.wildcards-not-permitted" />;
	} else if (!dnsProviderWildcardSupported) {
		hint = <T id="domain-names.wildcards-not-supported" />;
	}
	const isValidDomain = validateDomain(isWildcardPermitted && dnsProviderWildcardSupported, forCertificate);
	return (
		<FormField id={id} label={<T id={label} />} required hint={hint} error={error}>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name={name}
					multiple
					creatable
					disabled={readOnly}
					isValidNew={isValidDomain}
					value={field.value ?? []}
					onBlur={field.onBlur}
					placeholder={intl.formatMessage({ id: "domain-names.placeholder" })}
					onChange={(domains) => {
						field.onChange(domains);
						onChange?.(domains);
					}}
				/>
			)}
		</FormField>
	);
}
