import { useState } from "react";
import { updateAuth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, NoticeAlert } from "src/components";
import { HookForm, PasswordInput, useAppForm } from "src/components/Form";
import { T } from "src/locale";
import { setPasswordValidate } from "src/modules/AccountForms";
import EasyModal from "src/modules/easyModal";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showSetPasswordModal = (id) => {
	EasyModal.show(SetPasswordModal, { id });
};

const validate = setPasswordValidate(validations);

const SetPasswordModal = EasyModal.create(({ id, visible, remove }) => {
	const [error, setError] = useState(null);
	const methods = useAppForm({ defaultValues: { new: "" }, validate });
	const {
		register,
		formState: { errors, isSubmitting },
	} = methods;

	const onSubmit = async (values) => {
		setError(null);
		try {
			await updateAuth(id, values.new);
			showObjectSuccess("user", "updated");
			remove();
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : remove} backdrop="static">
			<HookForm methods={methods} onSubmit={onSubmit}>
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title>
						<T id="user.set-password" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
					<NoticeAlert>
						<T id="logout-other-devices" />
					</NoticeAlert>
					<div className="mb-3">
						<PasswordInput
							{...register("new")}
							id="new"
							label={<T id="user.new-password" />}
							autoComplete="new-password"
							required
							error={errors.new?.message ?? null}
						/>
					</div>
				</AppModal.Body>
				<AppModal.Footer>
					<Button className="btn-link link-secondary" onClick={remove} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit className="ms-auto" color="primary" isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="save" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showSetPasswordModal };
