import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { deleteAvatar, uploadAvatar } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	GravatarFormatter,
	HookForm,
	Loading,
	SwitchField,
	useAppForm,
} from "src/components";
import { DirtyTracker, useSetUser, useUnsavedChangesGuard, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { userValidate } from "src/modules/AccountForms";
import EasyModal from "src/modules/easyModal";
import { isAdmin } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

/**
 * @param {number|string} id         a user's id, "new" or "me"
 * @param {string}        [section]  "users" when opened from the users list (its Save colour), none from the header
 */
const showUserModal = (id, section) => {
	EasyModal.show(UserModal, { id, section });
};

const validate = userValidate(validations);

const emptyUser = { name: "", email: "", isAdmin: false, isDisabled: false };

const UserModal = EasyModal.create(({ id, section, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useUser(id);
	const { data: currentUser, isPending: currentIsPending } = useUser("me");
	const { mutateAsync: setUser } = useSetUser();
	const [errorMsg, setErrorMsg] = useState(null);
	const queryClient = useQueryClient();
	const fileInput = useRef(null);
	const methods = useAppForm({
		defaultValues: emptyUser,
		values: data
			? {
					name: data.name ?? "",
					email: data.email ?? "",
					isAdmin: Boolean(isAdmin(data.roles)),
					isDisabled: Boolean(data.isDisabled),
				}
			: undefined,
		validate,
	});
	const {
		register,
		formState: { errors, isSubmitting },
	} = methods;
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

	const onSubmit = async (values) => {
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

		try {
			await setUser(payload);
			showObjectSuccess("user", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{(isPending || currentIsPending) && <Loading noLogo />}
			{data && currentUser && (
				<HookForm methods={methods} onSubmit={onSubmit}>
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
								<GravatarFormatter url={data?.avatar} name={data?.name} size="lg" />

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
									<Button color="danger" outline onClick={() => changeAvatar(() => deleteAvatar(id))}>
										<T id="avatar.remove" />
									</Button>
								)}
							</div>
						)}
						<div className="mb-3">
							<div className="form-floating mb-3">
								<input
									id="name"
									autoComplete="off"
									required
									className={`form-control ${errors.name ? "is-invalid" : ""}`}
									placeholder={intl.formatMessage({
										id: "user.full-name",
									})}
									{...register("name")}
								/>

								<label htmlFor="name">
									<T id="user.full-name" />
								</label>
								{errors.name ? <div className="invalid-feedback">{errors.name.message}</div> : null}
							</div>
						</div>
						<div className="mb-3">
							<div className="form-floating mb-3">
								<input
									id="email"
									type="email"
									autoComplete="off"
									required
									className={`form-control ${errors.email ? "is-invalid" : ""}`}
									placeholder={intl.formatMessage({
										id: "email-address",
									})}
									{...register("email")}
								/>

								<label htmlFor="email">
									<T id="email-address" />
								</label>
								{errors.email ? <div className="invalid-feedback">{errors.email.message}</div> : null}
							</div>
						</div>
						{currentUser?.id !== data?.id ? (
							<div className="my-3">
								<h4 className="py-2">
									<T id="options" />
								</h4>
								<div className="divide-y">
									<SwitchField id="isAdmin" label={<T id="role.admin" />} {...register("isAdmin")} />
									<SwitchField
										id="isDisabled"
										label={<T id="disabled" />}
										{...register("isDisabled")}
									/>
								</div>
							</div>
						) : null}
					</AppModal.Body>
					<AppModal.Footer>
						<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
							<T id="cancel" />
						</Button>
						<FormSubmit
							className="ms-auto"
							edit={Boolean(data?.id)}
							section={section}
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

export { showUserModal };
