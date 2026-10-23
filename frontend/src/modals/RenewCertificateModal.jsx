import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { renewCertificate } from "src/api/backend";
import { ApiErrorContent, AppModal, Button, ErrorAlert, Loading, RequestProgress } from "src/components";
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
		<AppModal show={visible} onHide={isSubmitting ? undefined : remove}>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T id="certificate.renew" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert>{errorMsg}</ErrorAlert>
				{isPending && <Loading noLogo />}
				{error && <ErrorAlert error={error} className="m-3" />}
				<RequestProgress running={isSubmitting} />
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="ms-auto" onClick={remove} disabled={isSubmitting}>
					<T id="action.close" />
				</Button>
			</AppModal.Footer>
		</AppModal>
	);
});

export { showRenewCertificateModal };
