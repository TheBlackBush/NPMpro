import { IconPlus } from "@tabler/icons-react";
import { useController } from "react-hook-form";
import Select from "react-select";
import { useDnsCredentials } from "src/hooks";
import { intl, T } from "src/locale";
import { showDnsCredentialModal } from "src/modals";
import { selectClassNames } from "src/modules/Select";
import { FormField, selectControlProps } from "./FormField";

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
		.map((c) => ({ value: c.id, label: c.name, isDisabled: Boolean(c.decryptError) }));

	const addLabel = intl.formatMessage({ id: "dns-credentials.add" });

	return (
		<FormField id="dnsCredential" label={<T id="dns-credentials.select" />} required hint={hint} error={error}>
			{(control) => (
				<div className="d-flex gap-2">
					<div className="flex-fill">
						<Select
							{...selectControlProps(control)}
							ref={field.ref}
							unstyled
							classNames={selectClassNames}
							name={name}
							closeMenuOnSelect={true}
							isClearable={false}
							isLoading={isPending}
							isSearchable
							required
							onBlur={field.onBlur}
							placeholder={intl.formatMessage({
								id: options.length ? "dns-credentials.select" : "dns-credentials.none-for-provider",
							})}
							options={options}
							value={options.find((o) => o.value === field.value) ?? null}
							onChange={(o) => field.onChange(o?.value)}
						/>
					</div>
					<button
						type="button"
						className="btn btn-icon"
						aria-label={addLabel}
						title={addLabel}
						onClick={() =>
							showDnsCredentialModal("new", { provider, onSaved: (row) => field.onChange(row.id) })
						}
					>
						<IconPlus size={16} />
					</button>
				</div>
			)}
		</FormField>
	);
}
