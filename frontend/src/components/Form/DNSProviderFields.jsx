import { useController, useFormContext, useWatch } from "react-hook-form";
import Select from "react-select";
import { useDnsProviders } from "src/hooks";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { NoticeAlert } from "../NoticeAlert";
import { DnsCredentialSelect } from "./DnsCredentialSelect";
import { useRecheckDependent } from "./HookForm";

// the provider; another provider's credential does not fit, so a change empties it (its message shows again once
// it may)
function ProviderSelect({ providerId }) {
	const { setValue } = useFormContext();
	const { field, fieldState } = useController({ name: "npmproDnsProvider" });
	const recheckCredential = useRecheckDependent("npmproDnsCredentialId");
	const error = fieldState.error?.message ?? null;
	const { data: dnsProviders, isPending } = useDnsProviders();
	// deprecated providers are not offered for new certificates, only kept when already selected
	const options = dnsProviders
		?.filter((p) => !p.deprecated || p.id === providerId)
		.map((p) => ({
			value: p.id,
			label: p.name,
		}));
	return (
		<div className="row">
			<label htmlFor="dnsProvider" className="form-label">
				<T id="certificates.dns.provider" />
			</label>
			<Select
				ref={field.ref}
				unstyled
				classNames={selectClassNames}
				name="npmproDnsProvider"
				inputId="dnsProvider"
				closeMenuOnSelect={true}
				isClearable={false}
				placeholder={intl.formatMessage({
					id: "certificates.dns.provider.placeholder",
				})}
				isLoading={isPending}
				isSearchable
				required
				aria-invalid={error ? "true" : undefined}
				aria-describedby={error ? "dnsProvider-error" : undefined}
				onBlur={field.onBlur}
				onChange={(newValue) => {
					field.onChange(newValue?.value);
					setValue("npmproDnsCredentialId", null, { shouldDirty: true });
					recheckCredential();
				}}
				options={options}
			/>
			{error ? (
				<div className="invalid-feedback d-block" id="dnsProvider-error">
					{error}
				</div>
			) : null}
		</div>
	);
}

// the seconds to wait for the DNS records; 0 means the default of the DNS plugin, shown as an empty field
function PropagationInput() {
	const { field, fieldState } = useController({ name: "npmproPropagationSeconds" });
	const error = fieldState.error?.message ?? null;
	return (
		<div className="mt-3">
			<label htmlFor="propagationSeconds" className="form-label">
				<T id="certificates.dns.propagation-seconds" />
			</label>
			<input
				ref={field.ref}
				id="propagationSeconds"
				type="number"
				className={`form-control ${error ? "is-invalid" : ""}`}
				aria-invalid={error ? "true" : undefined}
				min={0}
				max={7200}
				placeholder={intl.formatMessage({
					id: "certificates.dns.propagation-seconds-default",
				})}
				name="npmproPropagationSeconds"
				onBlur={field.onBlur}
				value={field.value || ""}
				onChange={(e) => field.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
			/>
			{error ? <div className="invalid-feedback">{error}</div> : null}
			<small className="text-secondary">
				<T id="certificates.dns.propagation-seconds-note" />
			</small>
		</div>
	);
}

/**
 * The DNS challenge fields of the form around it: the notice, the provider and, with a provider, the credential and
 * the propagation time. The form's resolver checks them (CertificateForms.js dnsChallengeRules).
 */
export function DNSProviderFields({ showBoundaryBox }) {
	const providerId = useWatch({ name: "npmproDnsProvider" });
	return (
		<div className={showBoundaryBox ? "py-3 border border-orange border-opacity-10 rounded bg-cyan-lt" : undefined}>
			<NoticeAlert>
				<T id="certificates.dns.warning" />
			</NoticeAlert>
			<ProviderSelect providerId={providerId} />
			{providerId ? (
				<>
					<DnsCredentialSelect name="npmproDnsCredentialId" provider={providerId} />
					<p className="mt-2 mb-0">
						<small className="text-secondary">
							<T id="certificates.dns.credentials-saved-note" />
						</small>
					</p>
					<PropagationInput />
				</>
			) : null}
		</div>
	);
}
