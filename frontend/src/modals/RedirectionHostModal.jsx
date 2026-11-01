import { useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	DomainNamesField,
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
	useRedirectionHost,
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
	windowTitleId,
} from "src/modules/HostForms";
import { MANAGE, REDIRECTION_HOSTS } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const showRedirectionHostModal = (id) => {
	EasyModal.show(RedirectionHostModal, { id });
};

const validate = redirectionHostValidate(validations);

// the redirect status codes, in the select's order
const REDIRECTION_HTTP_CODES = [301, 302, 303, 307, 308];

function RedirectionHostForm({ data, savedId, errorMsg, onCloseError, close }) {
	const { register } = useFormContext();
	const { isSubmitting } = useFormState();
	const readOnly = useReadOnly();
	const [certificateId, npmproDnsChallenge, advancedConfig, npmproPropagationSeconds] = useWatch({
		name: ["certificateId", "npmproDnsChallenge", "advancedConfig", "npmproPropagationSeconds"],
	});
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T
						id={windowTitleId({ editing: Boolean(savedId || data.id), readOnly })}
						tData={{ object: "redirection-host" }}
					/>
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
								<SelectField name="forwardScheme" label={<T id="host.forward-scheme" />}>
									<option value="$scheme">
										{intl.formatMessage({ id: "redirection.scheme.keep" })}
									</option>
									<option value="http">http</option>
									<option value="https">https</option>
								</SelectField>
							</div>
							<div className="col-md-6">
								<TextField
									name="forwardDomainName"
									label={<T id="redirection-host.forward-domain" />}
									required
									type="text"
									placeholder="example.com"
								/>
							</div>
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
				<RequestProgress
					running={isSubmitting && certificateId === "new"}
					propagationSeconds={npmproPropagationSeconds}
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
					<T id={readOnly ? "action.close" : "cancel"} />
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
function RedirectionHostEditor({ id, data, save, remove, dirtyRef, readOnly, ...formProps }) {
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
		<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
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
	// a user who may only view the section gets a View window
	const readOnly = !useCanManage(REDIRECTION_HOSTS);
	const { data, error } = useRedirectionHost(id);
	const tlsSettled = useTlsQueriesSettled();
	const { mutateAsync: save, isPending: isSaving } = useSetRedirectionHost();
	// never false again once true: a refetch keeps data (also when it fails), tlsSettled is latched
	const ready = Boolean(data) && tlsSettled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static" size="lg">
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<RedirectionHostEditor
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

export { showRedirectionHostModal };
