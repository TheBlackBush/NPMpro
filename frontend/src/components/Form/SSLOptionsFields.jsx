import { useController, useFormContext, useWatch } from "react-hook-form";
import { DNSProviderFields, DomainNamesField, SwitchField } from "src/components";
import { T } from "src/locale";
import { applyChanges } from "src/modules/HookForm";
import { domainNamesOptions, hiddenTlsFields, tlsChanges } from "src/modules/HostForms";
import { namedLocations } from "src/modules/ProxyHostForms";
import { useRecheckDependent } from "./HookForm";

/**
 * A change on the TLS tab of a React Hook Form host window, called after the field's own controller set its value:
 * sets what it turns off or on (HostForms.js tlsChanges), drops the messages of the fields it hides, and re-checks the
 * domain names, whose rule follows the certificate and the DNS challenge
 *
 * @param   {Object}  [options]
 * @param   {boolean} [options.forHttp]  false for a stream
 * @returns {Function} (name, value) => void
 */
export function useTlsChange({ forHttp = true } = {}) {
	const { getValues, setValue, clearErrors } = useFormContext();
	const recheckDomainNames = useRecheckDependent("domainNames");
	return (name, value) => {
		const values = getValues();
		const changes = tlsChanges(values, name, value, { forHttp });
		// the changed field is already set, unless the change overrides it (an mTLS certificate forces HTTPS)
		const dependents = Object.fromEntries(
			Object.entries(changes).filter(([key, next]) => key !== name || next !== value),
		);
		applyChanges(setValue, dependents);
		clearErrors(hiddenTlsFields({ ...values, ...changes }, { forHttp }));
		if ("certificateId" in changes || "npmproDnsChallenge" in changes) recheckDomainNames();
	};
}

const TLS_FIELDS = [
	"certificateId",
	"sslForced",
	"hstsEnabled",
	"npmproDnsChallenge",
	"npmproMtlsCertificateId",
	"npmproMtlsVerifyClientOptional",
	"npmproAuthRequest",
	"locations",
];

// a switch of the TLS tab: its controller sets the value, then onTlsChange sets what it turns off or on; shown is
// what the switch displays when that differs from the value
function TlsSwitch({ name, onTlsChange, shown, ...props }) {
	const { field } = useController({ name });
	return (
		<SwitchField
			{...props}
			id={name}
			name={field.name}
			ref={field.ref}
			checked={shown === undefined ? Boolean(field.value) : shown(field.value)}
			onChange={(e) => {
				field.onChange(e.target.checked);
				onTlsChange(name, e.target.checked);
			}}
			onBlur={field.onBlur}
		/>
	);
}

/**
 * The TLS options of a host window: mTLS, HTTPS options (HTTP hosts), and for a requested certificate its key, the
 * DNS challenge (always for a stream, with the certificate's domain names) and the DNS provider fields. Each switch
 * is a controller, a change runs useTlsChange.
 */
export function SSLOptionsFields({ forHttp = true, forProxyHost }) {
	const [
		certificateId,
		sslForced,
		hstsEnabled,
		dnsChallenge,
		npmproMtlsCertificateId,
		npmproMtlsVerifyClientOptional,
		npmproAuthRequest,
		locations,
	] = useWatch({ name: TLS_FIELDS });
	const onTlsChange = useTlsChange({ forHttp });

	const newCertificate = certificateId === "new";
	const hasCertificate = newCertificate || certificateId > 0;
	const mtlsBypassAuthRequestPossible =
		npmproMtlsVerifyClientOptional &&
		[{ npmproAuthRequest }, ...namedLocations(locations ?? [])].some(
			({ npmproAuthRequest: authRequest = "none" }) => authRequest !== "none",
		);
	const mtlsRequired = npmproMtlsCertificateId > 0 && !npmproMtlsVerifyClientOptional;

	return (
		<div>
			<div className="divide-y">
				<TlsSwitch
					name="npmproMtlsVerifyClientOptional"
					label={<T id="domains.mtls-verify-client-optional" />}
					onTlsChange={onTlsChange}
					disabled={!(certificateId > 0 && npmproMtlsCertificateId > 0)}
				/>
				{forProxyHost ? (
					<TlsSwitch
						name="npmproMtlsBypassAuthRequest"
						label={<T id="domains.mtls-bypass-auth-request" />}
						onTlsChange={onTlsChange}
						shown={(value) => value === true && Boolean(mtlsBypassAuthRequestPossible)}
						disabled={!mtlsBypassAuthRequestPossible}
					/>
				) : null}
				{forHttp ? (
					<>
						<TlsSwitch
							name="sslForced"
							label={<T id="domains.force-ssl" />}
							onTlsChange={onTlsChange}
							disabled={!hasCertificate || mtlsRequired}
						/>
						<TlsSwitch
							name="npmproHttp3Support"
							label={<T id="domains.http3-support" />}
							onTlsChange={onTlsChange}
							disabled={!hasCertificate}
						/>
						<TlsSwitch
							name="hstsEnabled"
							label={<T id="host.flags.hsts-enabled" />}
							onTlsChange={onTlsChange}
							disabled={!hasCertificate || !sslForced}
						/>
						<TlsSwitch
							name="hstsSubdomains"
							label={<T id="host.flags.hsts-subdomains" />}
							onTlsChange={onTlsChange}
							disabled={!hasCertificate || !hstsEnabled}
						/>
					</>
				) : null}
				{newCertificate ? (
					<>
						<TlsSwitch
							name="npmproReuseKey"
							label={<T id="domains.reuse-key" />}
							onTlsChange={onTlsChange}
						/>
						<TlsSwitch
							name="npmproDnsChallenge"
							label={<T id="domains.use-dns" />}
							onTlsChange={onTlsChange}
							shown={(value) => !forHttp || Boolean(value)}
							disabled={!forHttp}
						/>
					</>
				) : null}
			</div>
			{newCertificate && !forHttp ? <DomainNamesField {...domainNamesOptions({}, { forHttp })} /> : null}
			{newCertificate && dnsChallenge ? <DNSProviderFields showBoundaryBox /> : null}
		</div>
	);
}
