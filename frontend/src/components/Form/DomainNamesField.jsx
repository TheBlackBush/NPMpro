import { useMemo, useState } from "react";
import { useController, useFormContext } from "react-hook-form";
import { Combobox } from "src/components/Combobox";
import { useDomainSuggestions } from "src/hooks";
import { intl, T } from "src/locale";
import { displayDomain } from "src/modules/DnsDomainForms";
import { domainSuggestions } from "src/modules/DomainSuggestions";
import { validateDomain } from "src/modules/Validations";
import { FormField } from "./FormField";
import { usePendingEntry, useReadOnly } from "./HookForm";

// the muted text on the right of a suggestion: its credential, the wildcard note or what uses the name
const detailText = (detail) => {
	if (detail?.kind === "wildcard") return intl.formatMessage({ id: "domain-names.wildcard" });
	if (detail?.kind === "used") return intl.formatMessage({ id: `domain-names.source.${detail.source}` });
	return detail?.credentialName ?? "";
};

export function SuggestionRow({ option }) {
	return (
		<span className="flex min-w-0 items-baseline justify-between gap-3">
			<span className="min-w-0 break-all">{option.label}</span>
			<span className="shrink-0 text-xs text-muted-foreground">{detailText(option.detail)}</span>
		</span>
	);
}

const refusedMessage = (refused) => intl.formatMessage({ id: "error.invalid-domain" }, { domain: refused.join(", ") });

/**
 * The domain names of the form around it: the label (required), the chips select, the error and the hint about
 * wildcards. The form's resolver checks the list (domainNamesRule); onChange(domains) runs after the field took the
 * new list. Text typed without Enter is added on save; text that is not a valid domain refuses the save with a
 * message, which goes once the text changes. The typed text is completed with the DNS domains and the names hosts
 * and certificates use (suggestions={false} turns that off); "Add ..." stays the first entry, so any valid name can
 * still be typed.
 */
export function DomainNamesField({
	name = "domainNames",
	label = "domain-names",
	id = "domainNames",
	isWildcardPermitted,
	dnsProviderWildcardSupported,
	forCertificate,
	suggestions = true,
	onChange,
}) {
	const { field, fieldState } = useController({ name });
	const { trigger } = useFormContext();
	const pending = usePendingEntry(name, refusedMessage);
	const readOnly = useReadOnly();
	const error = fieldState.error?.message ?? null;
	let hint = null;
	if (!isWildcardPermitted) {
		hint = <T id="domain-names.wildcards-not-permitted" />;
	} else if (!dnsProviderWildcardSupported) {
		hint = <T id="domain-names.wildcards-not-supported" />;
	}
	const wildcards = Boolean(isWildcardPermitted && dnsProviderWildcardSupported);
	const isValidDomain = useMemo(() => validateDomain(wildcards, forCertificate), [wildcards, forCertificate]);
	const [query, setQuery] = useState("");
	const { data: suggested } = useDomainSuggestions({ enabled: suggestions });
	const options = useMemo(
		() =>
			suggestions
				? domainSuggestions({
						query,
						zones: suggested?.zones,
						names: suggested?.names,
						values: field.value,
						wildcards,
						isValid: isValidDomain,
					}).map((entry) => ({ ...entry, groupLabel: intl.formatMessage({ id: entry.groupLabelId }) }))
				: [],
		[suggestions, query, suggested, field.value, wildcards, isValidDomain],
	);
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
					options={options}
					filter={false}
					createFirst
					chipLabel={displayDomain}
					// the stored (ASCII) form of a name shown in Unicode
					chipProps={(entry) => ({ title: displayDomain(entry) === entry ? undefined : entry })}
					renderOption={(option) => <SuggestionRow option={option} />}
					value={field.value ?? []}
					onBlur={field.onBlur}
					commitRef={pending.ref}
					onQueryChange={(text) => {
						setQuery(text);
						pending.setPending(text.trim() !== "");
						// the message about refused typed text is about that text: the list's own check takes over
						if (fieldState.error?.type === "pending") void trigger(name);
					}}
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
