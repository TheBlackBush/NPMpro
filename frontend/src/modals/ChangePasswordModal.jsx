import { useState } from "react";
import { updateAuth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, NoticeAlert } from "src/components";
import { HookForm, PasswordField, useAppForm, useRecheckDependent } from "src/components/Form";
import { T } from "src/locale";
import { changePasswordValidate } from "src/modules/AccountForms";
import EasyModal from "src/modules/easyModal";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showChangePasswordModal = (id) => {
	EasyModal.show(ChangePasswordModal, { id });
};

const validate = changePasswordValidate(validations);

/**
 * The new password: a change re-checks the repeat once its message may show (useRecheckDependent reads the form
 * around it, so this is a child of HookForm)
 */
function NewPasswordField() {
	const recheckConfirm = useRecheckDependent("confirm");
	return (
		<PasswordField
			name="new"
			label={<T id="user.new-password" />}
			autoComplete="new-password"
			required
			registerOptions={{ onChange: recheckConfirm }}
		/>
	);
}

const ChangePasswordModal = EasyModal.create(({ id, visible, remove }) => {
	const [error, setError] = useState(null);
	const methods = useAppForm({ defaultValues: { current: "", new: "", confirm: "" }, validate });
	const { isSubmitting } = methods.formState;

	const onSubmit = async (values) => {
		setError(null);
		try {
			await updateAuth(id, values.new, values.current);
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
						<T id="user.change-password" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
					<NoticeAlert>
						<T id="logout-other-devices" />
					</NoticeAlert>
					<PasswordField
						name="current"
						label={<T id="user.current-password" />}
						autoComplete="current-password"
						required
					/>
					<NewPasswordField />
					<PasswordField
						name="confirm"
						label={<T id="user.confirm-password" />}
						autoComplete="new-password"
						required
					/>
				</AppModal.Body>
				<AppModal.Footer>
					<Button className="btn-link link-secondary" onClick={remove} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit className="ms-auto" isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="save" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showChangePasswordModal };
