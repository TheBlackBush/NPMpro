import { IconPlus } from "@tabler/icons-react";
import { useField, useFormikContext } from "formik";
import Select from "react-select";
import { useDnsCredentials } from "src/hooks";
import { intl, T } from "src/locale";
import { showDnsCredentialModal } from "src/modals";
import { selectClassNames } from "src/modules/Select";
import { validateRequired } from "src/modules/Validations";

const required = validateRequired();

export function DnsCredentialSelect({ name, provider }) {
	const [field, meta, helpers] = useField({ name, validate: required });
	const { submitCount } = useFormikContext();
	const error = meta.error && (meta.touched || submitCount > 0) ? meta.error : null;
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
						onBlur={() => helpers.setTouched(true)}
						placeholder={intl.formatMessage({
							id: options.length ? "dns-credentials.select" : "dns-credentials.none-for-provider",
						})}
						options={options}
						value={options.find((o) => o.value === field.value) ?? null}
						onChange={(o) => helpers.setValue(o?.value)}
					/>
				</div>
				<button
					type="button"
					className="btn btn-icon"
					aria-label={addLabel}
					title={addLabel}
					onClick={() =>
						showDnsCredentialModal("new", { provider, onSaved: (row) => helpers.setValue(row.id) })
					}
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
