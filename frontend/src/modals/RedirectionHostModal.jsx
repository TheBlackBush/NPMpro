import { useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	DomainNamesField,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	ModalTabs,
	NginxConfigField,
	RequestProgress,
	SSLCertificateField,
	SSLOptionsFields,
	SwitchField,
	TabPane,
	useAppForm,
	useResetToSaved,
} from "src/components";
import {
	DirtyTracker,
	useDirectorySuggestions,
	useRedirectionHost,
	useRedirectionHosts,
	useSetRedirectionHost,
	useTlsQueriesSettled,
	useUnsavedChangesGuard,
} from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import {
	domainNamesOptions,
	REDIRECTION_HOST_TABS,
	redirectionHostDefaults,
	redirectionHostValidate,
	requestValues,
} from "src/modules/HostForms";
import { MANAGE, REDIRECTION_HOSTS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const showRedirectionHostModal = (id) => {
	EasyModal.show(RedirectionHostModal, { id });
};

const validate = redirectionHostValidate(validations);

function RedirectionHostForm({ data, savedId, suggestions, errorMsg, onCloseError, close }) {
	const { register } = useFormContext();
	const { errors, isSubmitting } = useFormState();
	const [certificateId, npmproDnsChallenge, advancedConfig, npmproPropagationSeconds] = useWatch({
		name: ["certificateId", "npmproDnsChallenge", "advancedConfig", "npmproPropagationSeconds"],
	});
	const forwardDomainError = errors.forwardDomainName?.message ?? null;
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T id={savedId || data.id ? "object.edit" : "object.add"} tData={{ object: "redirection-host" }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>
				<ModalTabs tabs={REDIRECTION_HOST_TABS} markers={{ advanced: advancedConfig?.trim() ? "*" : null }}>
					<TabPane id="details">
						<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
						<div className="row">
							<div className="col-md-6">
								<div className="mb-3">
									<label className="form-label" htmlFor="forwardScheme">
										<T id="host.forward-scheme" />
									</label>
									<select
										id="forwardScheme"
										className="form-select"
										required
										{...register("forwardScheme")}
									>
										<option value="$scheme">
											{intl.formatMessage({
												id: "redirection.scheme.keep",
											})}
										</option>
										<option value="http">http</option>
										<option value="https">https</option>
									</select>
								</div>
							</div>
							<div className="col-md-6">
								<div className="mb-3">
									<label className="form-label" htmlFor="forwardDomainName">
										<T id="redirection-host.forward-domain" />
									</label>
									<input
										id="forwardDomainName"
										type="text"
										className={`form-control ${forwardDomainError ? "is-invalid" : ""}`}
										required
										placeholder="example.com"
										{...register("forwardDomainName")}
									/>

									{forwardDomainError ? (
										<div className="invalid-feedback">{forwardDomainError}</div>
									) : null}
								</div>
							</div>
						</div>
						<div className="mb-3">
							<label className="form-label" htmlFor="forwardHttpCode">
								<T id="redirection-host.forward-http-code" />
							</label>
							<select
								id="forwardHttpCode"
								className="form-select"
								required
								{...register("forwardHttpCode", { valueAsNumber: true })}
							>
								<option value="301">
									<T id="redirection-hosts.http-code.301" />
								</option>
								<option value="302">
									<T id="redirection-hosts.http-code.302" />
								</option>
								<option value="303">
									<T id="redirection-hosts.http-code.303" />
								</option>
								<option value="307">
									<T id="redirection-hosts.http-code.307" />
								</option>
								<option value="308">
									<T id="redirection-hosts.http-code.308" />
								</option>
							</select>
						</div>
						<div className="my-3">
							<h4 className="py-2">
								<T id="options" />
							</h4>
							<div className="divide-y">
								<SwitchField
									id="preservePath"
									label={<T id="host.flags.preserve-path" />}
									{...register("preservePath")}
								/>
							</div>
						</div>
					</TabPane>
					<TabPane id="tls">
						<SSLCertificateField label="ssl-certificate" allowNew />

						<SSLOptionsFields />
					</TabPane>
					<TabPane id="advanced">
						<NginxConfigField />
						<div className="row mt-3">
							<div className="col-md-12 mb-3">
								<DirectoryField
									labelId="redirection-host.directory"
									datalistId="directory-suggestions-redirection"
									suggestions={suggestions}
								/>
							</div>
						</div>
					</TabPane>
				</ModalTabs>
				<RequestProgress
					running={isSubmitting && certificateId === "new"}
					propagationSeconds={npmproPropagationSeconds}
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<HasPermission section={REDIRECTION_HOSTS} permission={MANAGE} hideError>
					<FormSubmit
						className="ms-auto"
						edit={Boolean(data.id)}
						section="redirectionHosts"
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

// the form, mounted once the host is loaded and the reads of the TLS tab have settled (useTlsQueriesSettled):
// complete defaultValues from the first render, no reset on a refetch
function RedirectionHostEditor({ id, data, save, remove, dirtyRef, ...formProps }) {
	const [defaultValues] = useState(() => redirectionHostDefaults(data));
	const methods = useAppForm({ defaultValues, validate });
	const resetToSaved = useResetToSaved(methods);
	const [errorMsg, setErrorMsg] = useState(null);
	// set once a new host was created but its nginx config failed, so saving again updates it
	const [savedId, setSavedId] = useState(null);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			const row = await save({ id: savedId ?? (id === "new" ? undefined : id), ...requestValues(values) });
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess("redirection-host", "saved");
				remove();
				return;
			}
			setSavedId(row.id);
			// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend created,
			// otherwise saving again with "new" would request another one
			methods.setValue("certificateId", row.certificateId);
			resetToSaved();
			setErrorMsg(<NginxConfigErrorMsg obj="redirection-host" nginxErr={nginxErr} />);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<RedirectionHostForm
				data={data}
				savedId={savedId}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				{...formProps}
			/>
		</HookForm>
	);
}

const RedirectionHostModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, error } = useRedirectionHost(id);
	const tlsSettled = useTlsQueriesSettled();
	const { mutateAsync: save, isPending: isSaving } = useSetRedirectionHost();
	const { data: allRedirectionHosts } = useRedirectionHosts();
	const suggestions = useDirectorySuggestions(allRedirectionHosts);
	// never false again once true: a refetch keeps data (also when it fails), tlsSettled is latched
	const ready = Boolean(data) && tlsSettled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<RedirectionHostEditor
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

export { showRedirectionHostModal };
