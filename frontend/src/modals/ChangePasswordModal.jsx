import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { updateAuth } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormErrorNote, NoticeAlert } from "src/components";
import { PasswordInput } from "src/components/Form";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showChangePasswordModal = (id) => {
	EasyModal.show(ChangePasswordModal, { id });
};

const ChangePasswordModal = EasyModal.create(({ id, visible, remove }) => {
	const [error, setError] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values, { setSubmitting }) => {
		if (values.new !== values.confirm) {
			setError(<T id="error.passwords-must-match" />);
			setSubmitting(false);
			return;
		}

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
		<AppModal show={visible} onHide={isSubmitting ? undefined : remove}>
			<Formik
				initialValues={{
					current: "",
					new: "",
					confirm: "",
				}}
				onSubmit={onSubmit}
			>
				{() => (
					<Form>
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
							<FormErrorNote className="ms-auto me-3" />
							<Button type="submit" color="primary" isLoading={isSubmitting} disabled={isSubmitting}>
								<T id="save" />
							</Button>
						</AppModal.Footer>
					</Form>
				)}
			</Formik>
		</AppModal>
	);
});

export { showChangePasswordModal };
