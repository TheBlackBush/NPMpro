import { useState } from "react";
import { useController, useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	ErrorAlert,
	FormSection,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	ModalTabs,
	NginxConfigField,
	RequestProgress,
	SelectField,
	SSLCertificateField,
	SSLOptionsFields,
	SwitchField,
	SwitchList,
	TabPane,
	TextField,
	useAppForm,
	useReadOnly,
	useResetToSaved,
} from "src/components";
import {
	DirtyTracker,
	useCanManage,
	useSetStream,
	useStream,
	useTlsQueriesSettled,
	useUnsavedChangesGuard,
} from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { applyChanges } from "src/modules/HookForm";
import {
	forwardingChanges,
	hiddenTlsFields,
	isProxyTlsPossible,
	STREAM_TABS,
	streamDefaults,
	streamPayload,
	streamValidate,
	windowTitleId,
} from "src/modules/HostForms";
import { MANAGE, STREAMS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const showStreamModal = (id) => {
	EasyModal.show(StreamModal, { id });
};

const validate = streamValidate(validations);

// "TLS to upstream": shown off and disabled while it is not possible (no certificate, or UDP), its value kept
function ProxyTlsSwitch({ possible, udpForwarding }) {
	const { field } = useController({ name: "npmproProxyTls" });
	return (
		<SwitchField
			id="npmproProxyTls"
			label={<T id="streams.tls" />}
			hint={
				!(udpForwarding || possible) && (
					<span className="d-block">
						<T id="streams.tls.requires-certificate" />
					</span>
				)
			}
			name={field.name}
			ref={field.ref}
			checked={Boolean(field.value) && possible}
			disabled={!possible}
			onChange={(e) => field.onChange(e.target.checked)}
			onBlur={field.onBlur}
		/>
	);
}

function StreamForm({ data, savedId, errorMsg, onCloseError, close }) {
	const { register, getValues, setValue, clearErrors } = useFormContext();
	const { isSubmitting } = useFormState();
	const readOnly = useReadOnly();
	const [udpForwarding, tcpForwarding, certificateId, npmproAdvancedConfig, npmproPropagationSeconds] = useWatch({
		name: ["udpForwarding", "tcpForwarding", "certificateId", "npmproAdvancedConfig", "npmproPropagationSeconds"],
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
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T
						id={windowTitleId({ editing: Boolean(savedId || data.id), readOnly })}
						tData={{ object: "stream" }}
					/>
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>

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
						<div className="row">
							<div className="col-md-8">
								<TextField
									name="forwardingHost"
									label={<T id="stream.forward-host" />}
									type="text"
									required
									placeholder={intl.formatMessage({ id: "stream.forward-host.placeholder" })}
								/>
							</div>
							<div className="col-md-4">
								<TextField
									name="forwardingPort"
									label={<T id="host.forward-port" />}
									type="text"
									maxLength={12}
									placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
								/>
							</div>
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
								{tcpForwarding && !udpForwarding ? (
									<option value={1}>{intl.formatMessage({ id: "streams.pp.v1" })}</option>
								) : null}
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
				<RequestProgress
					running={isSubmitting && certificateId === "new"}
					propagationSeconds={npmproPropagationSeconds}
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
					<T id={readOnly ? "action.close" : "cancel"} />
				</Button>
				<HasPermission section={STREAMS} permission={MANAGE} hideError>
					<FormSubmit
						className="ms-auto"
						edit={Boolean(data.id)}
						section="streams"
						isLoading={isSubmitting}
						disabled={isSubmitting}
					>
						<T id="save" />
					</FormSubmit>
				</HasPermission>
			</AppModal.Footer>
		</>
	);
}

// the form, mounted once the stream is loaded and the reads of the TLS tab have settled (useTlsQueriesSettled):
// complete defaultValues from the first render, no reset on a refetch
function StreamEditor({ id, data, save, remove, dirtyRef, readOnly, ...formProps }) {
	const [defaultValues] = useState(() => streamDefaults(data));
	const methods = useAppForm({ defaultValues, validate });
	const resetToSaved = useResetToSaved(methods);
	const [errorMsg, setErrorMsg] = useState(null);
	// set once a new stream was created but its nginx config failed, so saving again updates it
	const [savedId, setSavedId] = useState(null);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			const row = await save({ id: savedId ?? (id === "new" ? undefined : id), ...streamPayload(values) });
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess("stream", "saved");
				remove();
				return;
			}
			setSavedId(row.id);
			// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend created,
			// otherwise saving again with "new" would request another one
			methods.setValue("certificateId", row.certificateId);
			resetToSaved();
			setErrorMsg(<NginxConfigErrorMsg obj="stream" nginxErr={nginxErr} />);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<StreamForm
				data={data}
				savedId={savedId}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				{...formProps}
			/>
		</HookForm>
	);
}

const StreamModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	// a user who may only view the section gets a View window
	const readOnly = !useCanManage(STREAMS);
	const { data, error } = useStream(id);
	const tlsSettled = useTlsQueriesSettled();
	const { mutateAsync: save, isPending: isSaving } = useSetStream();
	// never false again once true: a refetch keeps data (also when it fails), tlsSettled is latched
	const ready = Boolean(data) && tlsSettled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static" size="lg">
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<StreamEditor
					readOnly={readOnly}
					id={id}
					data={data}
					save={save}
					remove={remove}
					dirtyRef={dirtyRef}
					close={close}
				/>
			)}
		</AppModal>
	);
});

export { showStreamModal };
