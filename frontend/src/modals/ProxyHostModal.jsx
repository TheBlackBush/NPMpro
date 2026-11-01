import { useState } from "react";
import { useFormState, useWatch } from "react-hook-form";
import {
	AccessFields,
	ApiErrorContent,
	AppModal,
	Button,
	DirectoryField,
	DomainNamesField,
	ErrorAlert,
	FormSection,
	FormSubmit,
	ForwardFields,
	HasPermission,
	HookForm,
	Loading,
	LocationsFields,
	ModalTabs,
	NginxConfigField,
	ProxyOptionsFields,
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
	useAccessLists,
	useCanManage,
	useDirectorySuggestions,
	useIsAdmin,
	useProxyHost,
	useProxyHosts,
	useSetProxyHost,
	useTlsQueriesSettled,
	useUnsavedChangesGuard,
} from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { domainNamesOptions, windowTitleId } from "src/modules/HostForms";
import { MANAGE, PROXY_HOSTS } from "src/modules/Permissions";
import {
	namedLocations,
	PROXY_HOST_TABS,
	proxyHostDefaults,
	proxyHostPayload,
	proxyHostValidate,
} from "src/modules/ProxyHostForms";
import { validations } from "src/modules/Validations";
import { getNginxConfigError, NginxConfigErrorMsg, showObjectSuccess } from "src/notifications";

// field name -> label for the note next to Save (no control has these names)
const FIELD_LABELS = {
	locations: "column.custom-locations",
	npmproAccessListIds: "proxy-host.global-access-lists",
};

const validate = proxyHostValidate(validations);

// the "*" of the Custom locations tab: a location with a path. Its own watch, so typing in a location row re-renders
// this marker, not the whole window
function LocationsTabMarker() {
	const locations = useWatch({ name: "locations" });
	return namedLocations(locations).length > 0 ? "*" : "";
}

function ProxyHostForm({ data, isClone, isAdmin, savedId, errorMsg, onCloseError, close, suggestions }) {
	const { isSubmitting } = useFormState();
	const readOnly = useReadOnly();
	const [
		certificateId,
		npmproDnsChallenge,
		npmproLocationConfig,
		npmproAuthRequest,
		advancedConfig,
		npmproPropagationSeconds,
	] = useWatch({
		name: [
			"certificateId",
			"npmproDnsChallenge",
			"npmproLocationConfig",
			"npmproAuthRequest",
			"advancedConfig",
			"npmproPropagationSeconds",
		],
	});

	// a non-admin with no config at all gets the one hint, not one per field
	const isEmptyBoth = !(isAdmin || advancedConfig?.trim() || npmproLocationConfig?.trim());

	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T
						id={windowTitleId({ editing: Boolean(savedId || (data.id && !isClone)), readOnly })}
						tData={{ object: "proxy-host" }}
					/>
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>
				<ModalTabs
					tabs={PROXY_HOST_TABS}
					markers={{
						locations: <LocationsTabMarker />,
						advanced: advancedConfig?.trim() || npmproLocationConfig?.trim() ? "*" : null,
					}}
				>
					<TabPane id="details">
						<DomainNamesField {...domainNamesOptions({ certificateId, npmproDnsChallenge })} />
						<ForwardFields />
						<DirectoryField
							labelId="proxy-host.directory"
							datalistId="directory-suggestions-proxy"
							suggestions={suggestions}
						/>
						<ProxyOptionsFields />
						<FormSection heading legend={<T id="proxy-host.global-access-lists" />} className="mb-0">
							<AccessFields
								name="npmproAccessListIds"
								typeName="npmproAccessListType"
								authRequest={npmproAuthRequest}
							/>
						</FormSection>
					</TabPane>
					<TabPane id="locations" selfReadOnly>
						<LocationsFields />
					</TabPane>
					<TabPane id="tls">
						<SSLCertificateField label="ssl-certificate" allowNew />

						<SSLOptionsFields forProxyHost />
					</TabPane>
					<TabPane id="advanced">
						<NginxConfigField emptyHint={!isEmptyBoth} />
						<NginxConfigField
							name="npmproLocationConfig"
							id="npmproLocationConfig"
							label="host.location-config.label"
							emptyHint={!isEmptyBoth}
						/>
						{isEmptyBoth && (
							<div className="text-secondary text-center my-3">
								<T id="nginx-config.admin-only" />
							</div>
						)}
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
				<HasPermission section={PROXY_HOSTS} permission={MANAGE} hideError>
					<FormSubmit
						labels={FIELD_LABELS}
						className="ms-auto"
						edit={Boolean(data.id) && !isClone}
						section="proxyHosts"
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

// the form, mounted once the host is loaded and the reads of the TLS tab and the access lists have settled
// (useTlsQueriesSettled): complete defaultValues from the first render, no reset on a refetch. A user whose role is
// not known yet (its read failed and retries) starts as a non-admin clone would (no raw nginx config)
function ProxyHostEditor({ id, isClone, isAdmin, data, save, remove, dirtyRef, readOnly, ...formProps }) {
	const [defaultValues] = useState(() => proxyHostDefaults(data, { isClone, isAdmin }));
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
				...proxyHostPayload(values),
			});
			const nginxErr = getNginxConfigError(row);
			if (nginxErr === null) {
				showObjectSuccess("proxy-host", "saved");
				remove();
				return;
			}
			setSavedId(row.id);
			// the changes are saved, only the nginx config needs fixing. Keep the certificate the backend created,
			// otherwise saving again with "new" would request another one
			methods.setValue("certificateId", row.certificateId);
			resetToSaved();
			setErrorMsg(<NginxConfigErrorMsg obj="proxy-host" nginxErr={nginxErr} />);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm readOnly={readOnly} methods={methods} onSubmit={onSubmit}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<ProxyHostForm
				data={data}
				isClone={isClone}
				isAdmin={isAdmin}
				savedId={savedId}
				errorMsg={errorMsg}
				onCloseError={() => setErrorMsg(null)}
				{...formProps}
			/>
		</HookForm>
	);
}

const ProxyHostModal = EasyModal.create(({ id, isClone, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	// a user who may only view the section gets a View window
	const readOnly = !useCanManage(PROXY_HOSTS);
	const { data, error } = useProxyHost(id);
	const isAdmin = useIsAdmin();
	// the key AccessFields reads, so nothing is fetched twice
	const accessLists = useAccessLists(["owner", "items", "clients"]);
	const settled = useTlsQueriesSettled({ accessLists });
	const { mutateAsync: save, isPending: isSaving } = useSetProxyHost();
	const { data: allProxyHosts } = useProxyHosts();
	const suggestions = useDirectorySuggestions(allProxyHosts);
	// never false again once true: a refetch keeps data (also when it fails), settled is latched
	const ready = Boolean(data) && settled;

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static" size="lg">
			{error && <ErrorAlert error={error} className="m-3" />}
			{!(ready || error) && <Loading noLogo />}
			{ready && (
				<ProxyHostEditor
					readOnly={readOnly}
					id={id}
					isClone={isClone}
					isAdmin={isAdmin}
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

const showProxyHostModal = (id, isClone) => {
	EasyModal.show(ProxyHostModal, { id, isClone });
};

export { showProxyHostModal };
