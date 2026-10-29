import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useController } from "react-hook-form";
import { createCertificate, uploadCertificate, validateCertificate } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	NoticeAlert,
	useAppForm,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import { customCertificateValidate } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showCustomCertificateModal = (cert, provider) => {
	EasyModal.show(CustomCertificateModal, { cert, provider });
};

// a required certificate file (a controller: its value is the chosen File); like any field, its message shows once
// the field was left or a save was tried, and then follows each change
function FileInput({ name, labelId }) {
	const { field, fieldState } = useController({ name });
	const error = fieldState.error?.message ?? null;
	return (
		<div className="mb-3">
			<label htmlFor={name} className="form-label">
				<T id={labelId} />
			</label>
			<input
				ref={field.ref}
				id={name}
				name={name}
				type="file"
				required
				autoComplete="off"
				className={`form-control ${error ? "is-invalid" : ""}`}
				aria-invalid={error ? "true" : undefined}
				aria-describedby={error ? `${name}-error` : undefined}
				onBlur={field.onBlur}
				onChange={(event) => field.onChange(event.currentTarget.files[0] ?? null)}
			/>
			{error ? (
				<div className="invalid-feedback" id={`${name}-error`}>
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
	const isEdit = Boolean(cert);
	const isMtls = (cert?.provider ?? provider) === "mtls";
	const validate = useMemo(() => customCertificateValidate(validations, { isEdit, isMtls }), [isEdit, isMtls]);
	const methods = useAppForm({
		defaultValues: { niceName: cert?.niceName || "", certificate: null, certificateKey: null },
		validate,
	});
	const {
		register,
		formState: { errors, isSubmitting },
	} = methods;

	const onSubmit = async (values) => {
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
			await queryClient.invalidateQueries({ queryKey: ["certificates"] });
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			<HookForm methods={methods} onSubmit={onSubmit}>
				<DirtyTracker dirtyRef={dirtyRef} />
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title>
						<T id={isEdit ? "object.edit" : "object.add"} tData={{ object: "certificates.custom" }} />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert className="mb-3" onClose={() => setErrorMsg(null)}>
						{errorMsg}
					</ErrorAlert>
					<NoticeAlert>
						<T id="certificates.custom.warning" />
					</NoticeAlert>
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
							className={`form-control ${errors.niceName ? "is-invalid" : ""}`}
							{...register("niceName")}
						/>

						{errors.niceName ? <div className="invalid-feedback">{errors.niceName.message}</div> : null}
					</div>
					<FileInput name="certificate" labelId="certificate.custom-certificate" />
					{!isMtls && <FileInput name="certificateKey" labelId="certificate.custom-certificate-key" />}
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
			</HookForm>
		</AppModal>
	);
});

export { showCustomCertificateModal };
