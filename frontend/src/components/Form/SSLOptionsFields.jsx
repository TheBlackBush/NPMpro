import { useController, useWatch } from "react-hook-form";
import { DNSProviderFields, DomainNamesField, SwitchField } from "src/components";
import { T } from "src/locale";
import { domainNamesOptions } from "src/modules/HostForms";
import { tlsDisabledReasons } from "src/modules/TlsOptions";
import { FormSection } from "./FormSection";
import { MtlsCertificateField } from "./SSLCertificateField";
import { SwitchList } from "./SwitchList";
import { useTlsChange } from "./useTlsChange";

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
 * The TLS options of a host window, under its certificate (SSLCertificateField): the mTLS CA certificate select, the
 * client certificate switches (mTLS), the HTTPS options (HTTP hosts) and, while a new certificate is requested, its
 * request (its key, the DNS challenge, for a stream its domain names, the DNS challenge box). The switches sit in two columns from the md
 * breakpoint, one on phones. Each switch is a controller, a change runs useTlsChange; a switch the TLS rules turn off
 * says why in its hint.
 */
export function SSLOptionsFields({ forHttp = true, forProxyHost = false }) {
	const watched = useWatch({ name: TLS_FIELDS });
	const values = Object.fromEntries(TLS_FIELDS.map((name, index) => [name, watched[index]]));
	const reasons = tlsDisabledReasons(values, { forHttp, forProxyHost });
	const onTlsChange = useTlsChange({ forHttp });
	const newCertificate = values.certificateId === "new";
	// the last section ends the tab, without the gap under it
	const lastSection = newCertificate ? "request" : forHttp ? "https" : "mtls";

	return (
		<>
			<MtlsCertificateField forHttp={forHttp} reason={reasons.npmproMtlsCertificateId} />
			<FormSection legend={<T id="tls.section.mtls" />} className={lastSection === "mtls" ? "mb-0" : undefined}>
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
			{forHttp ? (
				<FormSection
					legend={<T id="tls.section.https" />}
					className={lastSection === "https" ? "mb-0" : undefined}
				>
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
			{newCertificate ? (
				<FormSection legend={<T id="certificates.request.title" />} className="mb-0">
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
					{values.npmproDnsChallenge ? <DNSProviderFields className="mb-0" /> : null}
				</FormSection>
			) : null}
		</>
	);
}
