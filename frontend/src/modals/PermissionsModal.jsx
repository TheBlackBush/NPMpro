import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { setPermissions } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	Loading,
	useAppForm,
} from "src/components";
import { PermissionButtons, VisibilityButtons } from "src/components/Form/PermissionButtons";
import { DirtyTracker, useUnsavedChangesGuard, useUser } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { isAdmin } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";

const showPermissionsModal = (id) => {
	EasyModal.show(PermissionsModal, { id });
};

const SECTIONS = ["accessLists", "certificates", "deadHosts", "proxyHosts", "redirectionHosts", "streams"];

const permissionValues = (permissions) => ({
	visibility: permissions?.visibility ?? "user",
	...Object.fromEntries(SECTIONS.map((section) => [section, permissions?.[section] ?? "hidden"])),
});

/**
 * The buttons of one permission. PermissionButtons (shared with the Formik new-user defaults in Settings until A3)
 * takes a field and a form with getFieldProps and setFieldValue; here they read and set this form's values. This
 * Formik-shaped shim is the one deliberate exception to using React Hook Form directly; it goes in A3, when
 * PermissionButtons moves too.
 */
function PermissionRow({ name, Buttons }) {
	const { setValue } = useFormContext();
	const values = useWatch();
	const form = {
		getFieldProps: (field) => ({ value: values[field] }),
		setFieldValue: (field, value) => setValue(field, value, { shouldDirty: true }),
	};
	return <Buttons field={{ name, value: values[name] }} form={form} />;
}

const PermissionsModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const { data, isPending, error } = useUser(id);
	// no validation: every value comes from the buttons
	const methods = useAppForm({
		defaultValues: permissionValues(null),
		values: data ? permissionValues(data.permissions) : undefined,
	});
	const { isSubmitting } = methods.formState;

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await setPermissions(id, values);
			showObjectSuccess("user", "updated");
			remove();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["users"] }),
				queryClient.invalidateQueries({ queryKey: ["user"] }),
			]);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{isPending && <Loading noLogo />}
			{data && (
				<HookForm methods={methods} onSubmit={onSubmit}>
					<DirtyTracker dirtyRef={dirtyRef} />
					<AppModal.Header closeButton={!isSubmitting}>
						<AppModal.Title>
							<T id="user.set-permissions" data={{ name: data?.name }} />
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						<div className="mb-3">
							<div className="form-label">
								<T id="permissions.visibility.title" />
							</div>
							<PermissionRow name="visibility" Buttons={VisibilityButtons} />
						</div>
						{!isAdmin(data?.roles) && (
							<>
								<div className="mb-3">
									<div className="form-label">
										<T id="proxy-hosts" />
									</div>
									<PermissionRow name="proxyHosts" Buttons={PermissionButtons} />
								</div>
								<div className="mb-3">
									<div className="form-label">
										<T id="redirection-hosts" />
									</div>
									<PermissionRow name="redirectionHosts" Buttons={PermissionButtons} />
								</div>
								<div className="mb-3">
									<div className="form-label">
										<T id="dead-hosts" />
									</div>
									<PermissionRow name="deadHosts" Buttons={PermissionButtons} />
								</div>
								<div className="mb-3">
									<div className="form-label">
										<T id="streams" />
									</div>
									<PermissionRow name="streams" Buttons={PermissionButtons} />
								</div>
								<div className="mb-3">
									<div className="form-label">
										<T id="access-lists" />
									</div>
									<PermissionRow name="accessLists" Buttons={PermissionButtons} />
								</div>
								<div className="mb-3">
									<div className="form-label">
										<T id="certificates" />
									</div>
									<PermissionRow name="certificates" Buttons={PermissionButtons} />
								</div>
							</>
						)}
					</AppModal.Body>
					<AppModal.Footer>
						<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
							<T id="cancel" />
						</Button>
						<FormSubmit
							className="ms-auto"
							edit={true}
							color="primary"
							isLoading={isSubmitting}
							disabled={isSubmitting}
						>
							<T id="save" />
						</FormSubmit>
					</AppModal.Footer>
				</HookForm>
			)}
		</AppModal>
	);
});

export { showPermissionsModal };
