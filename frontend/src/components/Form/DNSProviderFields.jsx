import { Field, useFormikContext } from "formik";
import Select from "react-select";
import { useDnsProviders } from "src/hooks";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { NoticeAlert } from "../NoticeAlert";
import { DnsCredentialSelect } from "./DnsCredentialSelect";

export function DNSProviderFields({ showBoundaryBox }) {
	const { values, setFieldValue } = useFormikContext();
	const { data: dnsProviders, isPending } = useDnsProviders();

	const handleChange = (newValue, _actionMeta) => {
		void setFieldValue("npmproDnsProvider", newValue?.value);
		void setFieldValue("npmproDnsCredentialId", undefined);
	};

	const options = dnsProviders?.map((p) => ({
		value: p.id,
		label: p.name,
	}));

	return (
		<div className={showBoundaryBox ? "py-3 border border-orange border-opacity-10 rounded bg-cyan-lt" : undefined}>
			<NoticeAlert>
				<T id="certificates.dns.warning" />
			</NoticeAlert>

			<Field name="npmproDnsProvider">
				{({ field }) => (
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
							onChange={handleChange}
							options={options}
						/>
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
					<Field name="npmproPropagationSeconds">
						{({ field, form }) => (
							<div className="mt-3">
								<label htmlFor="propagationSeconds" className="form-label">
									<T id="certificates.dns.propagation-seconds" />
								</label>
								<input
									id="propagationSeconds"
									type="number"
									className="form-control"
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
