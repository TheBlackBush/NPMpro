import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { updateAuth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, NoticeAlert } from "src/components";
import { PasswordInput } from "src/components/Form";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showChangePasswordModal = (id) => {
	EasyModal.show(ChangePasswordModal, { id });
};

const validate = (values) =>
	values.confirm && values.new !== values.confirm
		? { confirm: intl.formatMessage({ id: "error.passwords-must-match" }) }
		: {};

const ChangePasswordModal = EasyModal.create(({ id, visible, remove }) => {
	const [error, setError] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setError(null);

		try {
			await updateAuth(id, values.new, values.current);
			showObjectSuccess("user", "updated");
			remove();
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
		setIsSubmitting(false);
		setSubmitting(false);
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : remove} backdrop="static">
			<Formik
				initialValues={{
					current: "",
					new: "",
					confirm: "",
				}}
				validate={validate}
				onSubmit={onSubmit}
			>
				{() => (
					<Form noValidate>
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
							<div className="mb-3">
								<Field name="current" validate={validateString(1, 255, false)}>
									{({ field, form }) => (
										<PasswordInput
											{...field}
											id="current"
											label={<T id="user.current-password" />}
											autoComplete="current-password"
											required
											error={
												form.errors.current && form.touched.current ? form.errors.current : null
											}
										/>
									)}
								</Field>
							</div>
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
							<div className="mb-3">
								<Field name="confirm" validate={validateString(8, 255, false)}>
									{({ field, form }) => (
										<PasswordInput
											{...field}
											id="confirm"
											label={<T id="user.confirm-password" />}
											autoComplete="new-password"
											required
											error={
												form.errors.confirm && form.touched.confirm ? form.errors.confirm : null
											}
										/>
									)}
								</Field>
							</div>
						</AppModal.Body>
						<AppModal.Footer>
							<Button className="btn-link link-secondary" onClick={remove} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<FormSubmit
								className="ms-auto"
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
		</AppModal>
	);
});

export { showChangePasswordModal };
