import { useController, useFormContext, useWatch } from "react-hook-form";
import {
	DirectoryField,
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
import { useSetStream, useStream } from "src/hooks";
import { intl, T } from "src/locale";
import { applyChanges } from "src/modules/HookForm";
import {
	forwardingChanges,
	hiddenTlsFields,
	isProxyTlsPossible,
	STREAM_TABS,
	streamDefaults,
	streamPayload,
	streamValidate,
} from "src/modules/HostForms";
import { STREAMS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { createHostEditorModal } from "./HostEditorModal";

// "TLS to upstream": shown off and disabled while it is not possible (no certificate, or UDP), its value kept
function ProxyTlsSwitch({ possible, udpForwarding }) {
	const { field } = useController({ name: "npmproProxyTls" });
	return (
		<SwitchField
			id="npmproProxyTls"
			label={<T id="streams.tls" />}
			hint={!(udpForwarding || possible) && <T id="streams.tls.requires-certificate" />}
			name={field.name}
			ref={field.ref}
			checked={Boolean(field.value) && possible}
			disabled={!possible}
			onChange={(e) => field.onChange(e.target.checked)}
			onBlur={field.onBlur}
		/>
	);
}

function StreamFields() {
	const { register, getValues, setValue, clearErrors } = useFormContext();
	const [udpForwarding, tcpForwarding, certificateId, npmproAdvancedConfig] = useWatch({
		name: ["udpForwarding", "tcpForwarding", "certificateId", "npmproAdvancedConfig"],
	});
	// TCP or UDP stays on; UDP drops TLS, the certificate and PROXY protocol v1. register has set the switch, the
	// change map sets the rest; the fields UDP hides lose their messages
	const onForwardingChange = (e) => {
		const current = getValues();
		const changes = forwardingChanges(current, e.target.name, e.target.checked);
		const { [e.target.name]: _set, ...others } = changes;
		applyChanges(setValue, others);
		clearErrors(hiddenTlsFields({ ...current, ...changes }, { forHttp: false }));
	};
	return (
		<ModalTabs
			tabs={STREAM_TABS}
			markers={{ advanced: npmproAdvancedConfig?.trim() ? "*" : null }}
			disabled={{ tls: udpForwarding }}
		>
			<TabPane id="details">
				<TextField
					name="incomingPort"
					label={<T id="stream.incoming-port" />}
					type="text"
					minLength={1}
					maxLength={11}
					required
					placeholder={intl.formatMessage({ id: "form.example" }, { example: "8080" })}
				/>
				<TextField
					name="npmproDescription"
					label={<T id="stream.description" />}
					type="text"
					maxLength={255}
					placeholder={intl.formatMessage({ id: "stream.description.placeholder" })}
				/>
				<div className="mb-3 grid items-start gap-3 sm:grid-cols-[2fr_1fr]">
					<TextField
						className="mb-0"
						name="forwardingHost"
						label={<T id="stream.forward-host" />}
						type="text"
						required
						placeholder={intl.formatMessage({ id: "stream.forward-host.placeholder" })}
					/>
					<TextField
						className="mb-0"
						name="forwardingPort"
						label={<T id="host.forward-port" />}
						type="text"
						maxLength={12}
						placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
					/>
				</div>
				<DirectoryField labelId="stream.directory" />
				<FormSection heading legend={<T id="host.flags.protocols" />} className="mb-0">
					<SwitchList className="mb-3">
						<SwitchField
							id="tcpForwarding"
							label={<T id="streams.tcp" />}
							{...register("tcpForwarding", { onChange: onForwardingChange })}
						/>
						<SwitchField
							id="udpForwarding"
							label={<T id="streams.udp" />}
							{...register("udpForwarding", { onChange: onForwardingChange })}
						/>
						<ProxyTlsSwitch
							possible={isProxyTlsPossible({ udpForwarding, certificateId })}
							udpForwarding={udpForwarding}
						/>
					</SwitchList>
					<SelectField
						name="npmproProxyProtocolForwarding"
						label={<T id="streams.pp" />}
						className="mb-0"
						registerOptions={{ valueAsNumber: true }}
					>
						<option value={0}>{intl.formatMessage({ id: "streams.pp.off" })}</option>
						<option value={1} disabled={!(tcpForwarding && !udpForwarding)}>
							{intl.formatMessage({ id: "streams.pp.v1" })}
						</option>
						<option value={2}>{intl.formatMessage({ id: "streams.pp.v2" })}</option>
					</SelectField>
				</FormSection>
			</TabPane>
			<TabPane id="tls">
				<SSLCertificateField label="ssl-certificate" allowNew forHttp={false} />

				<SSLOptionsFields forHttp={false} />
			</TabPane>
			{/* the config fields are read-only in a View window themselves, so they can still be focused and scrolled */}
			<TabPane id="advanced" selfReadOnly>
				<NginxConfigField
					name="npmproAdvancedConfig"
					id="npmproAdvancedConfig"
					label="nginx-config.server.label"
					hint="nginx-config.stream.hint"
				/>
			</TabPane>
		</ModalTabs>
	);
}

const showStreamModal = createHostEditorModal({
	object: "stream",
	section: STREAMS,
	useHost: useStream,
	useSave: useSetStream,
	defaults: streamDefaults,
	validate: streamValidate(validations),
	payload: streamPayload,
	Fields: StreamFields,
});

export { showStreamModal };
