import { useQueryClient } from "@tanstack/react-query";
import { Form, Formik } from "formik";
import { useState } from "react";
import Modal from "react-bootstrap/Modal";
import { setCertificateDnsCredential } from "src/api/backend";
import { ApiErrorContent, Button, DnsCredentialSelect, ErrorAlert } from "src/components";
import { DirtyTracker, useUnsavedChangesGuard } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { showObjectSuccess } from "src/notifications";

const showChangeDnsCredentialModal = (certificate) => {
	EasyModal.show(ChangeDnsCredentialModal, { certificate });
};

const ChangeDnsCredentialModal = EasyModal.create(({ certificate, visible, remove }) => {
	const queryClient = useQueryClient();
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const [errorMsg, setErrorMsg] = useState(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const onSubmit = async (values, { setSubmitting }) => {
		if (isSubmitting) return;
		setIsSubmitting(true);
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
		} finally {
			setIsSubmitting(false);
			setSubmitting(false);
		}
	};

	return (
		<Modal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			<Formik
				initialValues={{ npmproDnsCredentialId: certificate.npmproDnsCredentialId ?? undefined }}
				onSubmit={onSubmit}
			>
				{({ values }) => (
					<Form>
						<DirtyTracker dirtyRef={dirtyRef} />
						<Modal.Header closeButton={!isSubmitting}>
							<Modal.Title>
								<T id="dns-credentials.change" />
							</Modal.Title>
						</Modal.Header>
						<Modal.Body>
							<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
							<DnsCredentialSelect
								name="npmproDnsCredentialId"
								provider={certificate.npmproDnsProvider}
							/>
						</Modal.Body>
						<Modal.Footer>
							<Button onClick={close} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<Button
								type="submit"
								color="pink"
								className="ms-auto"
								isLoading={isSubmitting}
								disabled={isSubmitting || !values.npmproDnsCredentialId}
							>
								<T id="save" />
							</Button>
						</Modal.Footer>
					</Form>
				)}
			</Formik>
		</Modal>
	);
});

export { showChangeDnsCredentialModal };
