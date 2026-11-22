import { useController } from "react-hook-form";
import { Combobox } from "src/components/Combobox";
import { useDnsDomains } from "src/hooks";
import { intl, T } from "src/locale";
import { normalizeDnsDomain, storedForm, takenNames } from "src/modules/DnsDomainForms";
import { FormField } from "./FormField";
import { usePendingEntry, useReadOnly } from "./HookForm";

const EXPAND = ["credential"];
const refusedMessage = (refused) =>
	intl.formatMessage({ id: "error.dns-domain-invalid" }, { domain: refused.join(", ") });
const TAKEN_CHIP = "border-destructive text-destructive";

/**
 * The DNS domains of a credential as chips: each entry is checked as typed (normalizeDnsDomain) and stored in its
 * stored form; a name the owner keeps on another credential is marked, and the form's rule refuses the save for it.
 */
export function DnsDomainNamesField({ name = "domains", id = "dnsDomains", label, hint, credentialId, ownerUserId }) {
	const { field, fieldState } = useController({ name });
	const pending = usePendingEntry(name, refusedMessage);
	const readOnly = useReadOnly();
	const { data: domains } = useDnsDomains(EXPAND);
	const values = field.value ?? [];
	const taken = takenNames(values, { credentialId, ownerUserId, domains });
	return (
		<FormField
			id={id}
			label={label ?? <T id="dns-domains.names" />}
			hint={hint ?? <T id="dns-domains.names.hint" />}
			error={fieldState.error?.message ?? null}
		>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name={name}
					multiple
					creatable
					disabled={readOnly}
					isValidNew={(text) => !normalizeDnsDomain(text).error}
					value={values}
					onBlur={field.onBlur}
					commitRef={pending.ref}
					onQueryChange={(text) => pending.setPending(text.trim() !== "")}
					placeholder={intl.formatMessage({ id: "dns-domains.names.placeholder" })}
					chipClassName={(entry) => (taken.has(entry) ? TAKEN_CHIP : undefined)}
					chipProps={(entry) =>
						taken.has(entry)
							? {
									"data-dns-domain-taken": "",
									srText: intl.formatMessage(
										{ id: "dns-domains.taken-chip" },
										{ credential: taken.get(entry) },
									),
								}
							: undefined
					}
					onChange={(next) => field.onChange(storedForm(next))}
				/>
			)}
		</FormField>
	);
}
