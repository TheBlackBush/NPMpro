import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { setCertificateDnsCredential } from "src/api/backend";
import {
	ApiErrorContent,
	AppModal,
	Button,
	DnsCredentialSelect,
	ErrorAlert,
	FormSubmit,
	HookForm,
	useAppForm,
} from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import { changeDnsCredentialValidate } from "src/modules/CertificateForms";
import EasyModal from "src/modules/easyModal";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";

const showChangeDnsCredentialModal = (certificate) => {
	EasyModal.show(ChangeDnsCredentialModal, { certificate });
};

const validate = changeDnsCredentialValidate(validations);

const ChangeDnsCredentialModal = EasyModal.create(({ certificate, visible, remove }) => {
	const queryClient = useQueryClient();
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const [errorMsg, setErrorMsg] = useState(null);
	const methods = useAppForm({
		defaultValues: { npmproDnsCredentialId: certificate.npmproDnsCredentialId ?? null },
		validate,
	});
	const { isSubmitting } = methods.formState;

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await setCertificateDnsCredential(certificate.id, values.npmproDnsCredentialId);
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["certificates"] }),
				queryClient.invalidateQueries({ queryKey: ["dns-credentials"] }),
			]);
			showObjectSuccess("certificate", "updated");
			remove();
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
						<T id="dns-credentials.change" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
					<DnsCredentialSelect name="npmproDnsCredentialId" provider={certificate.npmproDnsProvider} />
				</AppModal.Body>
				<AppModal.Footer>
					<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit
						className="ms-auto"
						edit={true}
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

export { showChangeDnsCredentialModal };
