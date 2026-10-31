import { useState } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import {
	AccessClientFields,
	ApiErrorContent,
	AppModal,
	BasicAuthFields,
	Button,
	ErrorAlert,
	FormSubmit,
	HasPermission,
	HookForm,
	Loading,
	ModalTabs,
	SwitchField,
	TabPane,
	useAppForm,
} from "src/components";
import { DirtyTracker, useAccessList, useSetAccessList, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import {
	ACCESS_LIST_TABS,
	accessListDefaults,
	accessListPayload,
	accessListValidate,
} from "src/modules/AccessListForms";
import EasyModal from "src/modules/easyModal";
import { ACCESS_LISTS, MANAGE } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showAccessListModal = (id) => {
	EasyModal.show(AccessListModal, { id });
};

// field name -> label for the note next to Save
const FIELD_LABELS = { accessRules: "access-list.rules-required" };

function AccessListForm({ data, savedUsers, errorMsg, onCloseError, close }) {
	const { register } = useFormContext();
	const { errors, isSubmitted, isSubmitting } = useFormState();
	const nameError = errors.name?.message ?? null;
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T id={data.id ? "object.edit" : "object.add"} tData={{ object: "access-list" }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert className="mb-3" onClose={onCloseError}>
					{errorMsg}
				</ErrorAlert>
				{errors.accessRules && isSubmitted ? (
					<div className="invalid-feedback d-block mb-3" role="alert">
						{errors.accessRules.message}
					</div>
				) : null}
				<ModalTabs tabs={ACCESS_LIST_TABS}>
					<TabPane id="details">
						<div>
							<label htmlFor="name" className="form-label">
								<T id="column.name" />
							</label>
							<input
								id="name"
								type="text"
								required
								autoComplete="off"
								className={`form-control ${nameError ? "is-invalid" : ""}`}
								{...register("name")}
							/>

							{nameError ? <div className="invalid-feedback">{nameError}</div> : null}
						</div>
						<div className="my-3">
							<h3 className="py-2">
								<T id="options" />
							</h3>
							<div className="divide-y">
								<SwitchField
									id="satisfyAny"
									label={<T id="access-list.satisfy-any" />}
									{...register("satisfyAny")}
								/>
								<SwitchField
									id="passAuth"
									label={<T id="access-list.pass-auth" />}
									{...register("passAuth")}
								/>
							</div>
						</div>
					</TabPane>
					<TabPane id="auth">
						<BasicAuthFields savedUsers={savedUsers} />
					</TabPane>
					<TabPane id="rules">
						<AccessClientFields />
					</TabPane>
				</ModalTabs>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<HasPermission section={ACCESS_LISTS} permission={MANAGE} hideError>
					<FormSubmit
						labels={FIELD_LABELS}
						className="ms-auto"
						edit={Boolean(data.id)}
						section="accessLists"
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

// the form, mounted once the list is loaded: complete defaultValues from the first render, no reset on a refetch.
// The saved users and rules are taken from the same data as the defaults, so a refetch while the window is open
// changes neither the rules of the form nor the request
function AccessListEditor({ data, onSubmit, dirtyRef, ...formProps }) {
	const [saved] = useState(() => ({
		users: new Set(data.items.map((item) => item.username)),
		clients: data.clients,
	}));
	const [validate] = useState(() => accessListValidate(validations, { savedUsers: saved.users }));
	const [defaultValues] = useState(() => accessListDefaults(data));
	const methods = useAppForm({ defaultValues, validate });
	return (
		<HookForm methods={methods} onSubmit={(values) => onSubmit(values, saved.clients)}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<AccessListForm data={data} savedUsers={saved.users} {...formProps} />
		</HookForm>
	);
}

const AccessListModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useAccessList(id);
	const { mutateAsync: setAccessList, isPending: isSaving } = useSetAccessList();
	const [errorMsg, setErrorMsg] = useState(null);

	// savedClients: the rules the editor's starting values were built from
	const onSubmit = async (values, savedClients) => {
		setErrorMsg(null);
		try {
			await setAccessList({ id: id === "new" ? undefined : id, ...accessListPayload(values, savedClients) });
			showObjectSuccess("access-list", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSaving ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{isPending && <Loading noLogo />}
			{data && (
				<AccessListEditor
					data={data}
					onSubmit={onSubmit}
					dirtyRef={dirtyRef}
					errorMsg={errorMsg}
					onCloseError={() => setErrorMsg(null)}
					close={close}
				/>
			)}
		</AppModal>
	);
});

export { showAccessListModal };
