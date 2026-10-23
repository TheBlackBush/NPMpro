import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { updateAuth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, NoticeAlert } from "src/components";
import { PasswordInput } from "src/components/Form";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showSetPasswordModal = (id) => {
	EasyModal.show(SetPasswordModal, { id });
};

const SetPasswordModal = EasyModal.create(({ id, visible, remove }) => {
	const [error, setError] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setError(null);
		try {
			await updateAuth(id, values.new);
			showObjectSuccess("user", "updated");
			remove();
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
		setIsSubmitting(false);
		setSubmitting(false);
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : remove}>
			<Formik
				initialValues={{
					new: "",
				}}
				onSubmit={onSubmit}
			>
				{() => (
					<Form>
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
								<Field name="new" validate={validateString(8, 255, false)}>
									{({ field, form }) => (
										<PasswordInput
											{...field}
											id="new"
											label={<T id="user.new-password" />}
											autoComplete="new-password"
											required
											error={form.errors.new && form.touched.new ? form.errors.new : null}
										/>
									)}
								</Field>
							</div>
						</AppModal.Body>
						<AppModal.Footer>
							<Button className="btn-link link-secondary" onClick={remove} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<Button
								type="submit"
								color="primary"
								className="ms-auto"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="save" />
							</Button>
						</AppModal.Footer>
					</Form>
				)}
			</Formik>
		</AppModal>
	);
});

export { showSetPasswordModal };
