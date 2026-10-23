import { useQueryClient } from "@tanstack/react-query";
import { Field, Form, Formik } from "formik";
import { useRef, useState } from "react";
import { deleteAvatar, uploadAvatar } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, Loading, SwitchField } from "src/components";
import { DirtyTracker, useSetUser, useUnsavedChangesGuard, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { isAdmin } from "src/modules/Permissions";
import { validateEmail, validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showUserModal = (id) => {
	EasyModal.show(UserModal, { id });
};

const UserModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useUser(id);
	const { data: currentUser, isPending: currentIsPending } = useUser("me");
	const { mutate: setUser } = useSetUser();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const queryClient = useQueryClient();
	const fileInput = useRef(null);

	const changeAvatar = async (fn) => {
		setErrorMsg(null);
		try {
			await fn();
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["user"] }),
				queryClient.invalidateQueries({ queryKey: ["users"] }),
			]);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	const onSubmit = (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		const payload = {
			id: id === "new" ? undefined : id,
			roles: [],
			...values,
		};

		if (data?.id === currentUser?.id) {
			// Prevent user from locking themselves out
			delete payload.roles;
			delete payload.isDisabled;
		} else if (payload.isAdmin) {
			payload.roles = ["admin"];
		}

		// this isn't a real field, just for the form
		delete payload.isAdmin;

		setUser(payload, {
			onError: (err) => setErrorMsg(<ApiErrorContent error={err} />),
			onSuccess: () => {
				showObjectSuccess("user", "saved");
				remove();
			},
			onSettled: () => {
				setIsSubmitting(false);
				setSubmitting(false);
			},
		});
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{(isPending || currentIsPending) && <Loading noLogo />}
			{data && currentUser && (
				<Formik
					initialValues={{
						name: data?.name,
						email: data?.email,
						isAdmin: isAdmin(data?.roles),
						isDisabled: data?.isDisabled,
					}}
					onSubmit={onSubmit}
				>
					{() => (
						<Form>
							<DirtyTracker dirtyRef={dirtyRef} />
							<AppModal.Header closeButton={!isSubmitting}>
								<AppModal.Title>
									<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "user" }} />
								</AppModal.Title>
							</AppModal.Header>
							<AppModal.Body>
								<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
								{id !== "new" && (
									<div className="d-flex align-items-center mb-3">
										<span
											className="avatar avatar-square avatar-lg me-3"
											style={{
												backgroundImage: `url(${data?.avatar})`,
											}}
										/>

										<input
											ref={fileInput}
											type="file"
											accept="image/png,image/jpeg,image/gif,image/webp"
											className="d-none"
											onChange={(e) => {
												const file = e.target.files?.[0];
												void changeAvatar(() => uploadAvatar(id, file));
												e.target.value = "";
											}}
										/>

										<Button className="me-2" onClick={() => fileInput.current?.click()}>
											<T id="avatar.upload" />
										</Button>
										{data?.avatar?.startsWith("/images/avatar/") && (
											<Button
												color="danger"
												outline
												onClick={() => changeAvatar(() => deleteAvatar(id))}
											>
												<T id="avatar.remove" />
											</Button>
										)}
									</div>
								)}
								<div className="mb-3">
									<Field name="name" validate={validateString(1, 255)}>
										{({ field, form }) => (
											<div className="form-floating mb-3">
												<input
													id="name"
													autoComplete="off"
													required
													className={`form-control ${form.errors.name && form.touched.name ? "is-invalid" : ""}`}
													placeholder={intl.formatMessage({
														id: "user.full-name",
													})}
													{...field}
												/>

												<label htmlFor="name">
													<T id="user.full-name" />
												</label>
												{form.errors.name ? (
													<div className="invalid-feedback">
														{form.touched.name ? form.errors.name : null}
													</div>
												) : null}
											</div>
										)}
									</Field>
								</div>
								<div className="mb-3">
									<Field name="email" validate={validateEmail()}>
										{({ field, form }) => (
											<div className="form-floating mb-3">
												<input
													id="email"
													type="email"
													autoComplete="off"
													required
													className={`form-control ${form.errors.email && form.touched.email ? "is-invalid" : ""}`}
													placeholder={intl.formatMessage({
														id: "email-address",
													})}
													{...field}
												/>

												<label htmlFor="email">
													<T id="email-address" />
												</label>
												{form.errors.email ? (
													<div className="invalid-feedback">
														{form.touched.email ? form.errors.email : null}
													</div>
												) : null}
											</div>
										)}
									</Field>
								</div>
								{currentUser?.id !== data?.id ? (
									<div className="my-3">
										<h4 className="py-2">
											<T id="options" />
										</h4>
										<div className="divide-y">
											<div>
												<Field name="isAdmin" type="checkbox">
													{({ field }) => (
														<SwitchField
															id="isAdmin"
															label={<T id="role.admin" />}
															{...field}
														/>
													)}
												</Field>
											</div>
											<div>
												<Field name="isDisabled" type="checkbox">
													{({ field }) => (
														<SwitchField
															id="isDisabled"
															label={<T id="disabled" />}
															{...field}
														/>
													)}
												</Field>
											</div>
										</div>
									</div>
								) : null}
							</AppModal.Body>
							<AppModal.Footer>
								<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
								<Button
									type="submit"
									className="ms-auto"
									color="primary"
									isLoading={isSubmitting}
									disabled={isSubmitting}
								>
									<T id="save" />
								</Button>
							</AppModal.Footer>
						</Form>
					)}
				</Formik>
			)}
		</AppModal>
	);
});

export { showUserModal };
