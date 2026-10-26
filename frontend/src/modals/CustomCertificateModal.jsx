import { useQueryClient } from "@tanstack/react-query";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { createCertificate, uploadCertificate, validateCertificate } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, FormSubmit, NoticeAlert } from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { validateFile, validateString } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showCustomCertificateModal = (cert, provider) => {
	EasyModal.show(CustomCertificateModal, { cert, provider });
};

// a required certificate file; its error shows once a file was chosen or a submit was tried
function FileInput({ field, form, labelId }) {
	const error = form.touched[field.name] || form.submitCount > 0 ? form.errors[field.name] : null;
	return (
		<div className="mb-3">
			<label htmlFor={field.name} className="form-label">
				<T id={labelId} />
			</label>
			<input
				id={field.name}
				name={field.name}
				type="file"
				required
				autoComplete="off"
				className={`form-control ${error ? "is-invalid" : ""}`}
				aria-invalid={error ? "true" : undefined}
				aria-describedby={error ? `${field.name}-error` : undefined}
				onChange={(event) => {
					form.setFieldValue(field.name, event.currentTarget.files[0] ?? null);
					form.setFieldTouched(field.name, true, false);
				}}
			/>
			{error ? (
				<div className="invalid-feedback" id={`${field.name}-error`}>
					{error}
				</div>
			) : null}
		</div>
	);
}

const CustomCertificateModal = EasyModal.create(({ visible, remove, cert, provider = "other" }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const queryClient = useQueryClient();
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const isEdit = Boolean(cert);
	const isMtls = (cert?.provider ?? provider) === "mtls";

	const onSubmit = async (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
		setErrorMsg(null);

		try {
			const { niceName, certificate, certificateKey } = values;
			const formData = new FormData();

			formData.append("certificate", certificate);
			if (!isMtls) {
				formData.append("certificate_key", certificateKey);
			}

			// Validate
			await validateCertificate(formData);

			if (isEdit) {
				// Upload the certificates to the exiting certificate
				await uploadCertificate(cert.id, formData);
			} else {
				// Create certificate with the specified provider
				const newCert = await createCertificate({
					niceName,
					provider,
				});

				// Upload the certificates to the created certificate
				await uploadCertificate(newCert.id, formData);
			}

			// Success
			showObjectSuccess("certificate", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}

		await queryClient.invalidateQueries({ queryKey: ["certificates"] });
		setIsSubmitting(false);
		setSubmitting(false);
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			<Formik
				initialValues={{
					niceName: cert?.niceName || "",

					certificate: null,
					certificateKey: null,
				}}
				onSubmit={onSubmit}
			>
				{() => (
					<Form noValidate>
						<DirtyTracker dirtyRef={dirtyRef} />
						<AppModal.Header closeButton={!isSubmitting}>
							<AppModal.Title>
								<T
									id={isEdit ? "object.edit" : "object.add"}
									tData={{ object: "certificates.custom" }}
								/>
							</AppModal.Title>
						</AppModal.Header>
						<AppModal.Body>
							<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
								{errorMsg}
							</ErrorAlert>
							<NoticeAlert>
								<T id="certificates.custom.warning" />
							</NoticeAlert>
							<Field name="niceName" validate={isEdit ? undefined : validateString(1, 255)}>
								{({ field, form }) => (
									<div className="mb-3">
										<label htmlFor="niceName" className="form-label">
											<T id="column.name" />
										</label>
										<input
											id="niceName"
											type="text"
											required
											autoComplete="off"
											// Disable name editing in edit mode as we only update files
											disabled={isEdit}
											className={`form-control ${form.errors.niceName && form.touched.niceName ? "is-invalid" : ""}`}
											{...field}
										/>

										{form.errors.niceName ? (
											<div className="invalid-feedback">
												{form.touched.niceName ? form.errors.niceName : null}
											</div>
										) : null}
									</div>
								)}
							</Field>
							<Field name="certificate" validate={validateFile()}>
								{({ field, form }) => (
									<FileInput field={field} form={form} labelId="certificate.custom-certificate" />
								)}
							</Field>
							{!isMtls && (
								<Field name="certificateKey" validate={validateFile()}>
									{({ field, form }) => (
										<FileInput
											field={field}
											form={form}
											labelId="certificate.custom-certificate-key"
										/>
									)}
								</Field>
							)}
						</AppModal.Body>
						<AppModal.Footer>
							<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<FormSubmit
								className="ms-auto"
								edit={isEdit}
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

export { showCustomCertificateModal };
