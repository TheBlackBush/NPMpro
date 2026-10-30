import { IconPlus } from "@tabler/icons-react";
import { useController } from "react-hook-form";
import Select from "react-select";
import { useDnsCredentials } from "src/hooks";
import { intl, T } from "src/locale";
import { showDnsCredentialModal } from "src/modals";
import { selectClassNames } from "src/modules/Select";

// the label, the select, "+" and the error
function CredentialControl({ name, provider, value, error, onChange, onBlur, selectRef }) {
	const { data, isPending } = useDnsCredentials();

	const options = (data ?? [])
		.filter((c) => c.provider === provider)
		.map((c) => ({ value: c.id, label: c.name, isDisabled: Boolean(c.decryptError) }));

	const addLabel = intl.formatMessage({ id: "dns-credentials.add" });

	return (
		<div className="mt-3">
			<label htmlFor="dnsCredential" className="form-label">
				<T id="dns-credentials.select" />
			</label>
			<div className="d-flex gap-2">
				<div className="flex-fill">
					<Select
						ref={selectRef}
						unstyled
						classNames={selectClassNames}
						name={name}
						inputId="dnsCredential"
						closeMenuOnSelect={true}
						isClearable={false}
						isLoading={isPending}
						isSearchable
						required
						aria-invalid={error ? "true" : undefined}
						aria-describedby={error ? "dnsCredential-error" : undefined}
						onBlur={onBlur}
						placeholder={intl.formatMessage({
							id: options.length ? "dns-credentials.select" : "dns-credentials.none-for-provider",
						})}
						options={options}
						value={options.find((o) => o.value === value) ?? null}
						onChange={(o) => onChange(o?.value)}
					/>
				</div>
				<button
					type="button"
					className="btn btn-icon"
					aria-label={addLabel}
					title={addLabel}
					onClick={() => showDnsCredentialModal("new", { provider, onSaved: (row) => onChange(row.id) })}
				>
					<IconPlus size={16} />
				</button>
			</div>
			{error ? (
				<div className="invalid-feedback d-block" id="dnsCredential-error">
					{error}
				</div>
			) : null}
		</div>
	);
}

// in a React Hook Form form: the form's resolver checks it (CertificateForms.js)
function HookFormCredentialSelect({ name, provider }) {
	const { field, fieldState } = useController({ name });
	return (
		<CredentialControl
			name={name}
			provider={provider}
			value={field.value}
			error={fieldState.error?.message ?? null}
			onChange={field.onChange}
			onBlur={field.onBlur}
			selectRef={field.ref}
		/>
	);
}

export function DnsCredentialSelect({ name, provider }) {
	return <HookFormCredentialSelect name={name} provider={provider} />;
}
