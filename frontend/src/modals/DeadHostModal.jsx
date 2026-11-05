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
	useReadOnly,
	useResetToSaved,
} from "src/components";
import {
	DirtyTracker,
	useCanManage,
	useDeadHost,
	useIsAdmin,
	useSetDeadHost,
	useTlsQueriesSettled,
	useUnsavedChangesGuard,
} from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import {
	DEAD_HOST_TABS,
	deadHostDefaults,
	deadHostValidate,
	domainNamesOptions,
	requestValues,
	windowTitleId,
} from "src/modules/HostForms";
import { DEAD_HOSTS, MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

// isClone: the create window, prefilled from the host id (cloneValues empties what must be unique)
const showDeadHostModal = (id, isClone = false) => {
	EasyModal.show(DeadHostModal, { id, isClone });
};

const validate = deadHostValidate(validations);
const accent = sectionAccent("deadHosts");
const Icon = sectionIcon("deadHosts");

function DeadHostForm({ data, isClone, savedId, errorMsg, onCloseError, close }) {
	const { isSubmitting } = useFormState();
	const readOnly = useReadOnly();
	const [certificateId, npmproDnsChallenge, advancedConfig, npmproPropagationSeconds] = useWatch({
		name: ["certificateId", "npmproDnsChallenge", "advancedConfig", "npmproPropagationSeconds"],
	});
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title className="flex items-center gap-2">
					{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
					<T
						id={windowTitleId({ editing: Boolean(savedId || (data.id && !isClone)), readOnly })}
						tData={{ object: "dead-host" }}
					/>
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>
				<ModalTabs tabs={DEAD_HOST_TABS} markers={{ advanced: advancedConfig?.trim() ? "*" : null }}>
					<TabPane id="details">
						<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
						<DirectoryField labelId="dead-host.directory" className="mb-0" />
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
				<Button variant="ghost" onClick={close} disabled={isSubmitting}>
					<T id={readOnly ? "action.close" : "cancel"} />
				</Button>
				<HasPermission section={DEAD_HOSTS} permission={MANAGE} hideError>
					<FormSubmit edit={Boolean(data.id) && !isClone} isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="save" />
					</FormSubmit>
				</HasPermission>
			</AppModal.Footer>
		</>
	);
}

// the form, mounted once the host is loaded and the reads of the TLS tab have settled (useTlsQueriesSettled):
// complete defaultValues from the first render, no reset on a refetch
function DeadHostEditor({ id, isClone, isAdmin, data, save, remove, dirtyRef, readOnly, ...formProps }) {
	const [defaultValues] = useState(() => deadHostDefaults(data, { isClone, isAdmin }));
	const methods = useAppForm({ defaultValues, validate });
	const resetToSaved = useResetToSaved(methods);
	const [errorMsg, setErrorMsg] = useState(null);
	// set once a new host was created but its nginx config failed, so saving again updates it
	const [savedId, setSavedId] = useState(null);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			const row = await save({
				id: savedId ?? (id === "new" || isClone ? undefined : id),
				...requestValues(values),
			});
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
		<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<DeadHostForm
				data={data}
				isClone={isClone}
				savedId={savedId}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				{...formProps}
			/>
		</HookForm>
	);
}

const DeadHostModal = EasyModal.create(({ id, isClone, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	// a user who may only view the section gets a View window
	const readOnly = !useCanManage(DEAD_HOSTS);
	// a non-admin's clone leaves out the raw nginx config
	const isAdmin = useIsAdmin();
	const { data, error } = useDeadHost(id);
	const tlsSettled = useTlsQueriesSettled();
	const { mutateAsync: save, isPending: isSaving } = useSetDeadHost();
	// never false again once true: a refetch keeps data (also when it fails), tlsSettled is latched
	const ready = Boolean(data) && tlsSettled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static" size="lg">
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<DeadHostEditor
					readOnly={readOnly}
					id={id}
					isClone={isClone}
					isAdmin={isAdmin}
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

export { showDeadHostModal };
