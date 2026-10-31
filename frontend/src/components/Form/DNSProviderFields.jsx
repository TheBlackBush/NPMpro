import cn from "clsx";
import { useController, useFormContext, useWatch } from "react-hook-form";
import Select from "react-select";
import { useDnsProviders } from "src/hooks";
import { intl, T } from "src/locale";
import { selectClassNames } from "src/modules/Select";
import { NoticeAlert } from "../NoticeAlert";
import { DnsCredentialSelect } from "./DnsCredentialSelect";
import { FormField, selectControlProps } from "./FormField";
import { FormSection } from "./FormSection";
import { useRecheckDependent } from "./HookForm";

// the provider; another provider's credential does not fit, so a change empties it (its message shows again once
// it may). className: of the field, "mb-0" while it is the last one in the box
function ProviderSelect({ providerId, className }) {
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
		<FormField
			id="dnsProvider"
			label={<T id="certificates.dns.provider" />}
			required
			error={error}
			className={className}
		>
			{(control) => (
				<Select
					{...selectControlProps(control)}
					ref={field.ref}
					unstyled
					classNames={selectClassNames}
					name="npmproDnsProvider"
					closeMenuOnSelect={true}
					isClearable={false}
					placeholder={intl.formatMessage({
						id: "certificates.dns.provider.placeholder",
					})}
					isLoading={isPending}
					isSearchable
					required
					onBlur={field.onBlur}
					onChange={(newValue) => {
						field.onChange(newValue?.value);
						setValue("npmproDnsCredentialId", null, { shouldDirty: true });
						recheckCredential();
					}}
					options={options}
				/>
			)}
		</FormField>
	);
}

// the seconds to wait for the DNS records; 0 means the default of the DNS plugin, shown as an empty field
function PropagationInput() {
	const { field, fieldState } = useController({ name: "npmproPropagationSeconds" });
	const error = fieldState.error?.message ?? null;
	return (
		<FormField
			id="propagationSeconds"
			label={<T id="certificates.dns.propagation-seconds" />}
			hint={<T id="certificates.dns.propagation-seconds-note" />}
			error={error}
			className="mb-0"
		>
			{(control) => (
				<input
					{...control}
					ref={field.ref}
					type="number"
					className={cn("form-control", error && "is-invalid")}
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
			)}
		</FormField>
	);
}

/**
 * The DNS challenge fields of the form around it, in Tabler's form-fieldset box named "DNS challenge": the notice, the
 * provider and, with a provider, the credential and the propagation time. The form's resolver checks them
 * (CertificateForms.js dnsChallengeRules). The same box in the host windows' TLS tab and the DNS certificate window.
 */
export function DNSProviderFields() {
	const providerId = useWatch({ name: "npmproDnsProvider" });
	return (
		<FormSection boxed legend={<T id="certificates.dns.section" />}>
			<NoticeAlert>
				<T id="certificates.dns.warning" />
			</NoticeAlert>
			<ProviderSelect providerId={providerId} className={providerId ? undefined : "mb-0"} />
			{providerId ? (
				<>
					<DnsCredentialSelect
						name="npmproDnsCredentialId"
						provider={providerId}
						hint={<T id="certificates.dns.credentials-saved-note" />}
					/>
					<PropagationInput />
				</>
			) : null}
		</FormSection>
	);
}
