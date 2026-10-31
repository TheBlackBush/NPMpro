import { useController, useFormContext, useWatch } from "react-hook-form";
import { DNSProviderFields, DomainNamesField, SwitchField } from "src/components";
import { T } from "src/locale";
import { applyChanges } from "src/modules/HookForm";
import { domainNamesOptions, hiddenTlsFields, tlsChanges } from "src/modules/HostForms";
import { tlsDisabledReasons } from "src/modules/TlsOptions";
import { FormSection } from "./FormSection";
import { useRecheckDependent } from "./HookForm";
import { MtlsCertificateField } from "./SSLCertificateField";
import { SwitchList } from "./SwitchList";

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

// the values the TLS rules read (TlsOptions.js tlsDisabledReasons), and the DNS challenge
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

// why a control is off (a reason of tlsDisabledReasons), as its hint
const reasonHint = (reason) => (reason ? <T id={reason.id} tData={reason.tData} /> : null);

// a switch of the TLS tab: its controller sets the value, then onTlsChange sets what it turns off or on; shown is
// what the switch displays when that differs from the value. With a reason it is off and its hint says why.
function TlsSwitch({ name, onTlsChange, shown, reason, ...props }) {
	const { field } = useController({ name });
	return (
		<SwitchField
			{...props}
			id={name}
			name={field.name}
			ref={field.ref}
			checked={shown === undefined ? Boolean(field.value) : shown(field.value)}
			disabled={Boolean(reason)}
			hint={reasonHint(reason)}
			onChange={(e) => {
				field.onChange(e.target.checked);
				onTlsChange(name, e.target.checked);
			}}
			onBlur={field.onBlur}
		/>
	);
}

/**
 * The TLS options of a host window, under its certificate (SSLCertificateField), in the order of the choices: the
 * request of a new certificate (its key, the DNS challenge, for a stream its domain names, the DNS challenge box),
 * the HTTPS options (HTTP hosts), and the client certificates (mTLS). The switches sit in two columns from the md
 * breakpoint, one on phones. Each switch is a controller, a change runs useTlsChange; a switch the TLS rules turn off
 * says why in its hint.
 */
export function SSLOptionsFields({ forHttp = true, forProxyHost = false }) {
	const watched = useWatch({ name: TLS_FIELDS });
	const values = Object.fromEntries(TLS_FIELDS.map((name, index) => [name, watched[index]]));
	const reasons = tlsDisabledReasons(values, { forHttp, forProxyHost });
	const onTlsChange = useTlsChange({ forHttp });
	const newCertificate = values.certificateId === "new";

	return (
		<>
			{newCertificate ? (
				<FormSection legend={<T id="certificates.request.title" />}>
					<SwitchList columns={2}>
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
							reason={reasons.npmproDnsChallenge}
						/>
					</SwitchList>
					{forHttp ? null : <DomainNamesField {...domainNamesOptions({}, { forHttp })} />}
					{values.npmproDnsChallenge ? <DNSProviderFields /> : null}
				</FormSection>
			) : null}
			{forHttp ? (
				<FormSection legend={<T id="tls.section.https" />}>
					<SwitchList columns={2}>
						<TlsSwitch
							name="sslForced"
							label={<T id="domains.force-ssl" />}
							onTlsChange={onTlsChange}
							reason={reasons.sslForced}
						/>
						<TlsSwitch
							name="npmproHttp3Support"
							label={<T id="domains.http3-support" />}
							onTlsChange={onTlsChange}
							reason={reasons.npmproHttp3Support}
						/>
						<TlsSwitch
							name="hstsEnabled"
							label={<T id="host.flags.hsts-enabled" />}
							onTlsChange={onTlsChange}
							reason={reasons.hstsEnabled}
						/>
						<TlsSwitch
							name="hstsSubdomains"
							label={<T id="host.flags.hsts-subdomains" />}
							onTlsChange={onTlsChange}
							reason={reasons.hstsSubdomains}
						/>
					</SwitchList>
				</FormSection>
			) : null}
			<FormSection legend={<T id="tls.section.mtls" />} className="mb-0">
				<MtlsCertificateField
					forHttp={forHttp}
					disabled={Boolean(reasons.npmproMtlsCertificateId)}
					hint={reasonHint(reasons.npmproMtlsCertificateId)}
				/>
				<SwitchList columns={2}>
					<TlsSwitch
						name="npmproMtlsVerifyClientOptional"
						label={<T id="domains.mtls-verify-client-optional" />}
						onTlsChange={onTlsChange}
						reason={reasons.npmproMtlsVerifyClientOptional}
					/>
					{forProxyHost ? (
						<TlsSwitch
							name="npmproMtlsBypassAuthRequest"
							label={<T id="domains.mtls-bypass-auth-request" />}
							onTlsChange={onTlsChange}
							shown={(value) => value === true && !reasons.npmproMtlsBypassAuthRequest}
							reason={reasons.npmproMtlsBypassAuthRequest}
						/>
					) : null}
				</SwitchList>
			</FormSection>
		</>
	);
}
