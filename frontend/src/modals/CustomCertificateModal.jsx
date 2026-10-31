import { useQueryClient } from "@tanstack/react-query";
import cn from "clsx";
import { useMemo, useState } from "react";
import { useController, useFormContext } from "react-hook-form";
import { createCertificate, uploadCertificate, validateCertificate } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormField,
	FormSubmit,
	HookForm,
	NoticeAlert,
	TextField,
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

// a required certificate file (a controller: its value is the chosen File); a chosen file is checked at once, so a
// file that is too large is named right away
function FileInput({ name, labelId }) {
	const { trigger } = useFormContext();
	const { field, fieldState } = useController({ name });
	const error = fieldState.error?.message ?? null;
	return (
		<FormField id={name} label={<T id={labelId} />} required error={error}>
			{(control) => (
				<input
					{...control}
					ref={field.ref}
					name={name}
					type="file"
					required
					autoComplete="off"
					className={cn("form-control", error && "is-invalid")}
					onBlur={field.onBlur}
					onChange={(event) => {
						field.onChange(event.currentTarget.files[0] ?? null);
						void trigger(name);
					}}
				/>
			)}
		</FormField>
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
	const { isSubmitting } = methods.formState;

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
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		} finally {
			// also after a failed upload, as the certificate may already have been created
			await queryClient.invalidateQueries({ queryKey: ["certificates"] });
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
					<TextField
						name="niceName"
						label={<T id="column.name" />}
						autoComplete="off"
						// the name cannot be changed once created: an edit only uploads new files
						required={!isEdit}
						disabled={isEdit}
					/>
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
						section="certificates"
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
