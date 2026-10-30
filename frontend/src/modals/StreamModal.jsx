import { useState } from "react";
import { useController, useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	NginxConfigField,
	RequestProgress,
	SSLCertificateField,
	SSLOptionsFields,
	SwitchField,
	useAppForm,
	useResetToSaved,
} from "src/components";
import {
	DirtyTracker,
	useDirectorySuggestions,
	useSetStream,
	useStream,
	useStreams,
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
	streamDefaults,
	streamPayload,
	streamValidate,
} from "src/modules/HostForms";
import { MANAGE, STREAMS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const showStreamModal = (id) => {
	EasyModal.show(StreamModal, { id });
};

const validate = streamValidate(validations);

// a text field of the Details tab, its message once it was left or a save was tried
function TextField({ name, labelId, className = "mb-3", ...inputProps }) {
	const { register } = useFormContext();
	const { errors } = useFormState({ name });
	const error = errors[name]?.message ?? null;
	return (
		<div className={className}>
			<label className="form-label" htmlFor={name}>
				<T id={labelId} />
			</label>
			<input
				id={name}
				type="text"
				{...inputProps}
				className={`form-control ${error ? "is-invalid" : ""}`}
				{...register(name)}
			/>

			{error ? <div className="invalid-feedback">{error}</div> : null}
		</div>
	);
}

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

function StreamForm({ data, savedId, suggestions, errorMsg, onCloseError, close }) {
	const { register, getValues, setValue, clearErrors } = useFormContext();
	const { isSubmitting } = useFormState();
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
					<T id={savedId || data.id ? "object.edit" : "object.add"} tData={{ object: "stream" }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>

				<ul className="nav nav-tabs mb-3" data-bs-toggle="tabs">
					<li className="nav-item" role="presentation">
						<a
							href="#tab-details"
							className="nav-link active"
							data-bs-toggle="tab"
							aria-selected="true"
							role="tab"
						>
							<T id="column.details" />
						</a>
					</li>
					<li className="nav-item" role="presentation">
						<a
							href="#tab-ssl"
							className={`nav-link ${udpForwarding ? "disabled" : ""}`}
							data-bs-toggle={udpForwarding ? undefined : "tab"}
							aria-selected="false"
							aria-disabled={udpForwarding}
							role="tab"
						>
							<T id="column.ssl" />
						</a>
					</li>
					<li className="nav-item" role="presentation">
						<a
							href="#tab-advanced"
							className="nav-link"
							data-bs-toggle="tab"
							aria-selected="false"
							role="tab"
						>
							<T id="domains.advanced" />
							{npmproAdvancedConfig?.trim() ? "*" : ""}
						</a>
					</li>
				</ul>
				<div className="tab-content">
					<div className="tab-pane active show" id="tab-details" role="tabpanel">
						<TextField
							name="incomingPort"
							labelId="stream.incoming-port"
							minLength={1}
							maxLength={11}
							required
							placeholder={intl.formatMessage({ id: "form.example" }, { example: "8080" })}
						/>
						<TextField
							name="npmproDescription"
							labelId="stream.description"
							maxLength={255}
							placeholder={intl.formatMessage({ id: "stream.description.placeholder" })}
						/>
						<div className="row">
							<div className="col-md-8">
								<TextField
									name="forwardingHost"
									labelId="stream.forward-host"
									required
									placeholder={intl.formatMessage({ id: "stream.forward-host.placeholder" })}
								/>
							</div>
							<div className="col-md-4">
								<TextField
									name="forwardingPort"
									labelId="host.forward-port"
									maxLength={12}
									placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
								/>
							</div>
						</div>
						<div className="my-3">
							<h3 className="py-2">
								<T id="host.flags.protocols" />
							</h3>
							<div className="divide-y">
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
							</div>
							<div className="mt-3 mb-3">
								<label className="form-label" htmlFor="npmproProxyProtocolForwarding">
									<T id="streams.pp" />
								</label>
								<select
									id="npmproProxyProtocolForwarding"
									className="form-select"
									required
									{...register("npmproProxyProtocolForwarding", { valueAsNumber: true })}
								>
									<option value={0}>
										{intl.formatMessage({
											id: "streams.pp.off",
										})}
									</option>
									{tcpForwarding && !udpForwarding ? (
										<option value={1}>
											{intl.formatMessage({
												id: "streams.pp.v1",
											})}
										</option>
									) : null}
									<option value={2}>
										{intl.formatMessage({
											id: "streams.pp.v2",
										})}
									</option>
								</select>
							</div>
						</div>
					</div>
					<div className="tab-pane" id="tab-ssl" role="tabpanel">
						<SSLCertificateField label="ssl-certificate" allowNew forHttp={false} />

						<SSLOptionsFields forHttp={false} />
					</div>
					<div className="tab-pane" id="tab-advanced" role="tabpanel">
						<NginxConfigField name="npmproAdvancedConfig" id="npmproAdvancedConfig" />

						<div className="row mt-3">
							<div className="col-md-12 mb-3">
								<DirectoryField
									labelId="stream.directory"
									datalistId="directory-suggestions-stream"
									suggestions={suggestions}
								/>
							</div>
						</div>
					</div>
				</div>
				<RequestProgress
					running={isSubmitting && certificateId === "new"}
					propagationSeconds={npmproPropagationSeconds}
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<HasPermission section={STREAMS} permission={MANAGE} hideError>
					<FormSubmit
						className="ms-auto"
						edit={Boolean(data.id)}
						color="primary"
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
function StreamEditor({ id, data, save, remove, dirtyRef, ...formProps }) {
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
		<HookForm methods={methods} onSubmit={onSubmit}>
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
	const { data, error } = useStream(id);
	const tlsSettled = useTlsQueriesSettled();
	const { mutateAsync: save, isPending: isSaving } = useSetStream();
	const { data: allStreams } = useStreams();
	const suggestions = useDirectorySuggestions(allStreams);
	// never false again once true: a refetch keeps data (also when it fails), tlsSettled is latched
	const ready = Boolean(data) && tlsSettled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static" centered={false}>
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<StreamEditor
					id={id}
					data={data}
					save={save}
					remove={remove}
					dirtyRef={dirtyRef}
					suggestions={suggestions}
					close={close}
				/>
			)}
		</AppModal>
	);
});

export { showStreamModal };
