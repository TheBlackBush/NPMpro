import { useQueryClient } from "@tanstack/react-query";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { setPermissions } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, Loading } from "src/components";
import { PermissionButtons, VisibilityButtons } from "src/components/Form/PermissionButtons";
import { DirtyTracker, useUnsavedChangesGuard, useUser } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { isAdmin } from "src/modules/Permissions";
import { showObjectSuccess } from "src/notifications";

const showPermissionsModal = (id) => {
	EasyModal.show(PermissionsModal, { id });
};

const PermissionsModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const { data, isPending, error } = useUser(id);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
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
		setSubmitting(false);
		setIsSubmitting(false);
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{isPending && <Loading noLogo />}
			{data && (
				<Formik
					initialValues={{
						visibility: data.permissions?.visibility ?? "user",
						accessLists: data.permissions?.accessLists ?? "hidden",
						certificates: data.permissions?.certificates ?? "hidden",
						deadHosts: data.permissions?.deadHosts ?? "hidden",
						proxyHosts: data.permissions?.proxyHosts ?? "hidden",
						redirectionHosts: data.permissions?.redirectionHosts ?? "hidden",
						streams: data.permissions?.streams ?? "hidden",
					}}
					onSubmit={onSubmit}
				>
					{() => (
						<Form noValidate>
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
									<Field name="visibility">
										{({ field, form }) => <VisibilityButtons field={field} form={form} />}
									</Field>
								</div>
								{!isAdmin(data?.roles) && (
									<>
										<div className="mb-3">
											<div className="form-label">
												<T id="proxy-hosts" />
											</div>
											<Field name="proxyHosts">
												{({ field, form }) => <PermissionButtons field={field} form={form} />}
											</Field>
										</div>
										<div className="mb-3">
											<div className="form-label">
												<T id="redirection-hosts" />
											</div>
											<Field name="redirectionHosts">
												{({ field, form }) => <PermissionButtons field={field} form={form} />}
											</Field>
										</div>
										<div className="mb-3">
											<div className="form-label">
												<T id="dead-hosts" />
											</div>
											<Field name="deadHosts">
												{({ field, form }) => <PermissionButtons field={field} form={form} />}
											</Field>
										</div>
										<div className="mb-3">
											<div className="form-label">
												<T id="streams" />
											</div>
											<Field name="streams">
												{({ field, form }) => <PermissionButtons field={field} form={form} />}
											</Field>
										</div>
										<div className="mb-3">
											<div className="form-label">
												<T id="access-lists" />
											</div>
											<Field name="accessLists">
												{({ field, form }) => <PermissionButtons field={field} form={form} />}
											</Field>
										</div>
										<div className="mb-3">
											<div className="form-label">
												<T id="certificates" />
											</div>
											<Field name="certificates">
												{({ field, form }) => <PermissionButtons field={field} form={form} />}
											</Field>
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
						</Form>
					)}
				</Formik>
			)}
		</AppModal>
	);
});

export { showPermissionsModal };
