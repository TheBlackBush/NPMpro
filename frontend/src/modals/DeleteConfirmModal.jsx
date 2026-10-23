import { IconAlertTriangle } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import Modal from "react-bootstrap/Modal";
import { ApiErrorContent, Button, ErrorAlert } from "src/components";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";

const showDeleteConfirmModal = (props) => {
	EasyModal.show(DeleteConfirmModal, props);
};

const DeleteConfirmModal = EasyModal.create(
	({ title, tTitle, children, subject, details, onConfirm, invalidations, visible, remove }) => {
		const queryClient = useQueryClient();
		const [error, setError] = useState(null);
		const [isSubmitting, setIsSubmitting] = useState(false);
		const titleId = useId();

		const onSubmit = async () => {
			if (isSubmitting) return;
			setIsSubmitting(true);
			setError(null);
			try {
				await onConfirm();
				remove();
				// invalidate caches as requested
				await Promise.all(invalidations.map((inv) => queryClient.invalidateQueries({ queryKey: inv })));
			} catch (err) {
				setError(<ApiErrorContent error={err} />);
			}
			setIsSubmitting(false);
		};

		return (
			<Modal
				aria-labelledby={titleId}
				show={visible}
				onHide={isSubmitting ? undefined : remove}
				size="sm"
				centered
			>
				<button
					type="button"
					className="btn-close"
					aria-label={intl.formatMessage({ id: "cancel" })}
					onClick={remove}
					disabled={isSubmitting}
				/>
				<div className="modal-status bg-danger" />
				<Modal.Body className="text-center py-4">
					<IconAlertTriangle className="icon mb-2 text-danger icon-lg" aria-hidden="true" />
					<h3 id={titleId}>{tTitle ? <T id={tTitle} /> : title}</h3>
					<div className="text-secondary">
						{children}
						{subject ? <div className="mt-2 fw-bold text-break">{subject}</div> : null}
						{details ? <div className="mt-1 small text-break">{details}</div> : null}
					</div>
					<ErrorAlert className="mt-3 mb-0 text-start" onClose={() => setError(null)}>
						{error}
					</ErrorAlert>
				</Modal.Body>
				<Modal.Footer>
					<div className="w-100">
						<div className="row">
							<div className="col">
								<Button fullWidth onClick={remove} disabled={isSubmitting}>
									<T id="cancel" />
								</Button>
							</div>
							<div className="col">
								<Button
									type="submit"
									color="danger"
									fullWidth
									isLoading={isSubmitting}
									disabled={isSubmitting}
									onClick={onSubmit}
								>
									<T id={tTitle ?? "action.delete"} />
								</Button>
							</div>
						</div>
					</div>
				</Modal.Footer>
			</Modal>
		);
	},
);

export { showDeleteConfirmModal };
