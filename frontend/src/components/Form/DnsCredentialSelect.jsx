import { PlusIcon } from "lucide-react";
import { useController } from "react-hook-form";
import { Button } from "src/components/Button";
import { Combobox } from "src/components/Combobox";
import { useDnsCredentials } from "src/hooks";
import { intl, T } from "src/locale";
import { showDnsCredentialModal } from "src/modals";
import { FormField } from "./FormField";

/**
 * The DNS credential of a provider (a field of the form around it): the label, the select, "+" (a new credential of
 * the provider, chosen once saved), the error and the hint. The form's resolver checks it (CertificateForms.js).
 *
 * @param {Object} props
 * @param {string} props.name
 * @param {string} props.provider
 * @param {*}      [props.hint]
 */
export function DnsCredentialSelect({ name, provider, hint }) {
	const { field, fieldState } = useController({ name });
	const error = fieldState.error?.message ?? null;
	const { data, isPending } = useDnsCredentials();

	const options = (data ?? [])
		.filter((c) => c.provider === provider)
		.map((c) => ({ value: c.id, label: c.name, disabled: Boolean(c.decryptError) }));

	const addLabel = intl.formatMessage({ id: "dns-credentials.add" });

	return (
		<FormField id="dnsCredential" label={<T id="dns-credentials.select" />} required hint={hint} error={error}>
			{(control) => (
				<div className="flex gap-2">
					<div className="min-w-0 flex-1">
						<Combobox
							{...control}
							ref={field.ref}
							name={name}
							loading={isPending}
							onBlur={field.onBlur}
							placeholder={intl.formatMessage({
								id: options.length ? "dns-credentials.select" : "dns-credentials.none-for-provider",
							})}
							options={options}
							value={options.some((o) => o.value === field.value) ? field.value : null}
							onChange={(value) => field.onChange(value ?? undefined)}
						/>
					</div>
					<Button
						size="icon"
						aria-label={addLabel}
						title={intl.formatMessage({ id: "tooltip.dns-credential-add" })}
						onClick={() =>
							showDnsCredentialModal("new", { provider, onSaved: (row) => field.onChange(row.id) })
						}
					>
						<PlusIcon aria-hidden="true" />
					</Button>
				</div>
			)}
		</FormField>
	);
}
