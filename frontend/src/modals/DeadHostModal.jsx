import { useState } from "react";
import { useFormState, useWatch } from "react-hook-form";
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
	TabPane,
	useAppForm,
	useResetToSaved,
} from "src/components";
import {
	DirtyTracker,
	useDeadHost,
	useDeadHosts,
	useDirectorySuggestions,
	useSetDeadHost,
	useTlsQueriesSettled,
	useUnsavedChangesGuard,
} from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import {
	DEAD_HOST_TABS,
	deadHostDefaults,
	deadHostValidate,
	domainNamesOptions,
	requestValues,
} from "src/modules/HostForms";
import { DEAD_HOSTS, MANAGE } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

const showDeadHostModal = (id) => {
	EasyModal.show(DeadHostModal, { id });
};

const validate = deadHostValidate(validations);

function DeadHostForm({ data, savedId, suggestions, errorMsg, onCloseError, close }) {
	const { isSubmitting } = useFormState();
	const [certificateId, npmproDnsChallenge, advancedConfig, npmproPropagationSeconds] = useWatch({
		name: ["certificateId", "npmproDnsChallenge", "advancedConfig", "npmproPropagationSeconds"],
	});
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T id={savedId || data.id ? "object.edit" : "object.add"} tData={{ object: "dead-host" }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>
				<ModalTabs tabs={DEAD_HOST_TABS} markers={{ advanced: advancedConfig?.trim() ? "*" : null }}>
					<TabPane id="details">
						<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
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
									labelId="dead-host.directory"
									datalistId="directory-suggestions-dead"
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
				<HasPermission section={DEAD_HOSTS} permission={MANAGE} hideError>
					<FormSubmit
						className="ms-auto"
						edit={Boolean(data.id)}
						section="deadHosts"
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
function DeadHostEditor({ id, data, save, remove, dirtyRef, ...formProps }) {
	const [defaultValues] = useState(() => deadHostDefaults(data));
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
				showObjectSuccess("dead-host", "saved");
				remove();
				return;
			}
			setSavedId(row.id);
			// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend created,
			// otherwise saving again with "new" would request another one
			methods.setValue("certificateId", row.certificateId);
			resetToSaved();
			setErrorMsg(<NginxConfigErrorMsg obj="dead-host" nginxErr={nginxErr} />);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<DeadHostForm
				data={data}
				savedId={savedId}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				{...formProps}
			/>
		</HookForm>
	);
}

const DeadHostModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, error } = useDeadHost(id);
	const tlsSettled = useTlsQueriesSettled();
	const { mutateAsync: save, isPending: isSaving } = useSetDeadHost();
	const { data: allDeadHosts } = useDeadHosts();
	const suggestions = useDirectorySuggestions(allDeadHosts);
	// never false again once true: a refetch keeps data (also when it fails), tlsSettled is latched
	const ready = Boolean(data) && tlsSettled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<DeadHostEditor
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

export { showDeadHostModal };
