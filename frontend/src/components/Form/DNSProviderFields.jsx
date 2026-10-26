import { Field, useFormikContext } from "formik";
import Select from "react-select";
import { useDnsProviders } from "src/hooks";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { validateInteger, validateRequired } from "src/modules/Validations";
import { NoticeAlert } from "../NoticeAlert";
import { DnsCredentialSelect } from "./DnsCredentialSelect";

const requiredProvider = validateRequired();
const validPropagation = validateInteger({ min: 0, max: 7200 });

// a field's error once it was left or a submit was tried
const shownError = (form, name) => (form.touched[name] || form.submitCount > 0 ? form.errors[name] : null);

export function DNSProviderFields({ showBoundaryBox }) {
	const { values, setFieldValue } = useFormikContext();
	const { data: dnsProviders, isPending } = useDnsProviders();

	const handleChange = (newValue, _actionMeta) => {
		void setFieldValue("npmproDnsProvider", newValue?.value);
		void setFieldValue("npmproDnsCredentialId", undefined);
	};

	// deprecated providers are not offered for new certificates, only kept when already selected
	const options = dnsProviders
		?.filter((p) => !p.deprecated || p.id === values.npmproDnsProvider)
		.map((p) => ({
			value: p.id,
			label: p.name,
		}));

	return (
		<div className={showBoundaryBox ? "py-3 border border-orange border-opacity-10 rounded bg-cyan-lt" : undefined}>
			<NoticeAlert>
				<T id="certificates.dns.warning" />
			</NoticeAlert>

			<Field name="npmproDnsProvider" validate={requiredProvider}>
				{({ field, form }) => (
					<div className="row">
						<label htmlFor="dnsProvider" className="form-label">
							<T id="certificates.dns.provider" />
						</label>
						<Select
							unstyled
							classNames={selectClassNames}
							name={field.name}
							inputId="dnsProvider"
							closeMenuOnSelect={true}
							isClearable={false}
							placeholder={intl.formatMessage({
								id: "certificates.dns.provider.placeholder",
							})}
							isLoading={isPending}
							isSearchable
							required
							aria-invalid={shownError(form, field.name) ? "true" : undefined}
							aria-describedby={shownError(form, field.name) ? "dnsProvider-error" : undefined}
							onBlur={() => form.setFieldTouched(field.name, true)}
							onChange={handleChange}
							options={options}
						/>
						{shownError(form, field.name) ? (
							<div className="invalid-feedback d-block" id="dnsProvider-error">
								{shownError(form, field.name)}
							</div>
						) : null}
					</div>
				)}
			</Field>

			{values.npmproDnsProvider ? (
				<>
					<DnsCredentialSelect name="npmproDnsCredentialId" provider={values.npmproDnsProvider} />
					<p className="mt-2 mb-0">
						<small className="text-secondary">
							<T id="certificates.dns.credentials-saved-note" />
						</small>
					</p>
					<Field name="npmproPropagationSeconds" validate={validPropagation}>
						{({ field, form }) => (
							<div className="mt-3">
								<label htmlFor="propagationSeconds" className="form-label">
									<T id="certificates.dns.propagation-seconds" />
								</label>
								<input
									id="propagationSeconds"
									type="number"
									className={`form-control ${shownError(form, field.name) ? "is-invalid" : ""}`}
									aria-invalid={shownError(form, field.name) ? "true" : undefined}
									min={0}
									max={7200}
									placeholder={intl.formatMessage({
										id: "certificates.dns.propagation-seconds-default",
									})}
									name={field.name}
									onBlur={field.onBlur}
									// 0 means the default of the DNS plugin, shown as an empty field
									value={field.value || ""}
									onChange={(e) =>
										form.setFieldValue(
											field.name,
											e.target.value === "" ? 0 : Number(e.target.value),
										)
									}
								/>
								{shownError(form, field.name) ? (
									<div className="invalid-feedback">{shownError(form, field.name)}</div>
								) : null}
								<small className="text-secondary">
									<T id="certificates.dns.propagation-seconds-note" />
								</small>
							</div>
						)}
					</Field>
				</>
			) : null}
		</div>
	);
}
