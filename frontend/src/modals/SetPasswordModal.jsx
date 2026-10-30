import { useState } from "react";
import { updateAuth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, NoticeAlert } from "src/components";
import { HookForm, PasswordField, useAppForm } from "src/components/Form";
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
	const { isSubmitting } = methods.formState;

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
					<PasswordField
						name="new"
						label={<T id="user.new-password" />}
						autoComplete="new-password"
						required
					/>
				</AppModal.Body>
				<AppModal.Footer>
					<Button className="btn-link link-secondary" onClick={remove} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit className="ms-auto" section="users" isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="save" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showSetPasswordModal };
