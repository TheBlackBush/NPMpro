import { useState } from "react";
import { useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	RequestProgress,
	useAppForm,
	useReadOnly,
	useResetToSaved,
} from "src/components";
import { DirtyTracker, useCanManage, useIsAdmin, useTlsQueriesSettled, useUnsavedChangesGuard } from "src/hooks";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { windowTitleId } from "src/modules/HostForms";
import { MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";
import { sectionIcon } from "src/shell/useNavItems";

const useNoSettleOptions = () => undefined;

function HostEditorForm({ config, data, isClone, isAdmin, savedId, errorMsg, onCloseError, close }) {
	const { isSubmitting } = useFormState();
	const readOnly = useReadOnly();
	const [certificateId, npmproPropagationSeconds] = useWatch({ name: ["certificateId", "npmproPropagationSeconds"] });
	const { Fields, Icon, accent } = config;
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title className="flex items-center gap-2">
					{Icon ? <Icon className={cn("size-5 shrink-0", accent.text)} aria-hidden="true" /> : null}
					<T
						id={windowTitleId({ editing: Boolean(savedId || (data.id && !isClone)), readOnly })}
						tData={{ object: config.object }}
					/>
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>
				<Fields isAdmin={isAdmin} />
				<RequestProgress
					running={isSubmitting && certificateId === "new"}
					propagationSeconds={npmproPropagationSeconds}
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={close} disabled={isSubmitting}>
					<T id={readOnly ? "action.close" : "cancel"} />
				</Button>
				<HasPermission section={config.section} permission={MANAGE} hideError>
					<FormSubmit
						labels={config.fieldLabels}
						edit={Boolean(data.id) && !isClone}
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
function HostEditor({ config, id, isClone, isAdmin, data, save, remove, dirtyRef, readOnly, close }) {
	const [defaultValues] = useState(() => config.defaults(data, { isClone, isAdmin }));
	const methods = useAppForm({ defaultValues, validate: config.validate });
	const resetToSaved = useResetToSaved(methods);
	const [errorMsg, setErrorMsg] = useState(null);
	// set once a new host was created but its nginx config failed, so saving again updates it
	const [savedId, setSavedId] = useState(null);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			const row = await save({
				id: savedId ?? (id === "new" || isClone ? undefined : id),
				...config.payload(values),
			});
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess(config.object, "saved");
				remove();
				return;
			}
			setSavedId(row.id);
			// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend created,
			// otherwise saving again with "new" would request another one
			methods.setValue("certificateId", row.certificateId);
			resetToSaved();
			setErrorMsg(<NginxConfigErrorMsg obj={config.object} nginxErr={nginxErr} />);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<HostEditorForm
				config={config}
				data={data}
				isClone={isClone}
				isAdmin={isAdmin}
				savedId={savedId}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				close={close}
			/>
		</HookForm>
	);
}

function HostEditorWindow({ config, id, isClone, visible, remove }) {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	// a user who may only view the section gets a View window
	const readOnly = !useCanManage(config.section);
	// a non-admin's clone leaves out the raw nginx config
	const isAdmin = useIsAdmin();
	const { data, error } = config.useHost(id);
	const settled = useTlsQueriesSettled(config.useSettleOptions());
	const { mutateAsync: save, isPending: isSaving } = config.useSave();
	// never false again once true: a refetch keeps data (also when it fails), settled is latched
	const ready = Boolean(data) && settled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static" size="lg">
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<HostEditor
					config={config}
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
}

/**
 * The create, edit and view window of a host type. One window component per type (nice-modal keys windows by
 * component). The returned function opens it; isClone prefills the create window from the host id (cloneValues
 * empties what must be unique).
 *
 * @param {Object}   config
 * @param {string}   config.object       dead-host, ...: title, toasts and the nginx error text
 * @param {string}   config.section      section of the icon, the accent and the permission (deadHosts, ...)
 * @param {Function} config.useHost      (id) => the host query ("new" gives the empty host)
 * @param {Function} config.useSave      () => the save mutation
 * @param {Function} config.defaults     (data, { isClone, isAdmin }) => the form's values
 * @param {Function} config.validate     (values) => errors
 * @param {Function} config.payload      (values) => the request body
 * @param {Function} config.Fields       ({ isAdmin }) => the type's tabs
 * @param {Object}   [config.fieldLabels]       field name -> label id for the note next to Save
 * @param {Function} [config.useSettleOptions]  () => more reads the window waits for (useTlsQueriesSettled)
 * @returns {(id: number|string, isClone?: boolean) => void}
 */
export function createHostEditorModal({ useSettleOptions = useNoSettleOptions, ...rest }) {
	const config = { ...rest, useSettleOptions, accent: sectionAccent(rest.section), Icon: sectionIcon(rest.section) };
	const Window = EasyModal.create((props) => <HostEditorWindow config={config} {...props} />);
	return (id, isClone = false) => {
		EasyModal.show(Window, { id, isClone });
	};
}
