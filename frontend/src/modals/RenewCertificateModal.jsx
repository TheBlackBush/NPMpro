import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import Modal from "react-bootstrap/Modal";
import { renewCertificate } from "src/api/backend";
import { ApiErrorContent, Button, ErrorAlert, Loading, RequestProgress } from "src/components";
import { useCertificate } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { showObjectSuccess } from "src/notifications";

const showRenewCertificateModal = (id) => {
	EasyModal.show(RenewCertificateModal, { id });
};

const RenewCertificateModal = EasyModal.create(({ id, visible, remove }) => {
	const queryClient = useQueryClient();
	const { data, isPending, error } = useCertificate(id);
	const [errorMsg, setErrorMsg] = useState(null);
	const [isFresh, setIsFresh] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);

	useEffect(() => {
		if (!data || !isFresh) return;
		setIsFresh(false);
		setIsSubmitting(true);

		void (async () => {
			try {
				await renewCertificate(id);
				showObjectSuccess("certificate", "renewed");
				await queryClient.invalidateQueries({ queryKey: ["certificates"] });
				remove();
			} catch (err) {
				setErrorMsg(<ApiErrorContent error={err} />);
			} finally {
				setIsSubmitting(false);
			}
		})();
	}, [id, data, isFresh, remove, queryClient]);

	return (
		<Modal show={visible} onHide={isSubmitting ? undefined : remove}>
			<Modal.Header closeButton={!isSubmitting}>
				<Modal.Title>
					<T id="certificate.renew" />
				</Modal.Title>
			</Modal.Header>
			<Modal.Body>
				<ErrorAlert>{errorMsg}</ErrorAlert>
				{isPending && <Loading noLogo />}
				{error && <ErrorAlert error={error} className="m-3" />}
				{isSubmitting ? <p className="text-center mt-3">Please wait ...</p> : null}
			</Modal.Body>
			<RequestProgress running={isSubmitting} />
			<Modal.Footer>
				<Button onClick={remove} disabled={isSubmitting}>
					<T id="action.close" />
				</Button>
			</Modal.Footer>
		</Modal>
	);
});

export { showRenewCertificateModal };
