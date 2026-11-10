import { useFormContext, useWatch } from "react-hook-form";
import {
	DirectoryField,
	DomainNamesField,
	FormSection,
	ModalTabs,
	NginxConfigField,
	SelectField,
	SSLCertificateField,
	SSLOptionsFields,
	SwitchField,
	SwitchList,
	TabPane,
	TextField,
} from "src/components";
import { useRedirectionHost, useSetRedirectionHost } from "src/hooks";
import { intl, T } from "src/locale";
import {
	domainNamesOptions,
	REDIRECTION_HOST_TABS,
	redirectionHostDefaults,
	redirectionHostValidate,
	requestValues,
} from "src/modules/HostForms";
import { REDIRECTION_HOSTS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { createHostEditorModal } from "./HostEditorModal";

// the redirect status codes, in the select's order
const REDIRECTION_HTTP_CODES = [301, 302, 303, 307, 308];

function RedirectionHostFields() {
	const { register } = useFormContext();
	const [certificateId, npmproDnsChallenge, advancedConfig] = useWatch({
		name: ["certificateId", "npmproDnsChallenge", "advancedConfig"],
	});
	return (
		<ModalTabs tabs={REDIRECTION_HOST_TABS} markers={{ advanced: advancedConfig?.trim() ? "*" : null }}>
			<TabPane id="details">
				<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
				<div className="mb-3 grid items-start gap-3 sm:grid-cols-2">
					<SelectField className="mb-0" name="forwardScheme" label={<T id="host.forward-scheme" />}>
						<option value="$scheme">{intl.formatMessage({ id: "redirection.scheme.keep" })}</option>
						<option value="http">http</option>
						<option value="https">https</option>
					</SelectField>
					<TextField
						className="mb-0"
						name="forwardDomainName"
						label={<T id="redirection-host.forward-domain" />}
						required
						type="text"
						placeholder="example.com"
					/>
				</div>
				<SelectField
					name="forwardHttpCode"
					label={<T id="redirection-host.forward-http-code" />}
					registerOptions={{ valueAsNumber: true }}
				>
					{REDIRECTION_HTTP_CODES.map((code) => (
						<option key={code} value={code}>
							{intl.formatMessage({ id: `redirection-hosts.http-code.${code}` })}
						</option>
					))}
				</SelectField>
				<DirectoryField labelId="redirection-host.directory" />
				<FormSection heading legend={<T id="options" />} className="mb-0">
					<SwitchList>
						<SwitchField
							id="preservePath"
							label={<T id="host.flags.preserve-path" />}
							{...register("preservePath")}
						/>
					</SwitchList>
				</FormSection>
			</TabPane>
			<TabPane id="tls">
				<SSLCertificateField label="ssl-certificate" allowNew />

				<SSLOptionsFields />
			</TabPane>
			{/* the config fields are read-only in a View window themselves, so they can still be focused and scrolled */}
			<TabPane id="advanced" selfReadOnly>
				<NginxConfigField label="nginx-config.server.label" hint="nginx-config.server.hint" />
			</TabPane>
		</ModalTabs>
	);
}

const showRedirectionHostModal = createHostEditorModal({
	object: "redirection-host",
	section: REDIRECTION_HOSTS,
	useHost: useRedirectionHost,
	useSave: useSetRedirectionHost,
	defaults: redirectionHostDefaults,
	validate: redirectionHostValidate(validations),
	payload: requestValues,
	Fields: RedirectionHostFields,
});

export { showRedirectionHostModal };
