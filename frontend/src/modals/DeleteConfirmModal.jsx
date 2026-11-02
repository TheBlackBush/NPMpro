import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { ApiErrorContent, Button, ErrorAlert, NoticeAlert } from "src/components";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "src/components/ui/alert-dialog";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";

const showDeleteConfirmModal = (props) => {
	EasyModal.show(DeleteConfirmModal, props);
};

/**
 * A confirmation of a destructive action (delete, disable, reset): title, text, the item (subject, details), an
 * optional warning under them and the red confirm button
 */
const DeleteConfirmModal = EasyModal.create(
	({
		title,
		tTitle,
		confirmLabel,
		children,
		subject,
		details,
		warning,
		onConfirm,
		invalidations,
		visible,
		remove,
	}) => {
		const queryClient = useQueryClient();
		const [error, setError] = useState(null);
		const [isSubmitting, setIsSubmitting] = useState(false);

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

		// Escape and Cancel end here (an alert dialog ignores clicks outside it); nothing closes while the action runs
		const onOpenChange = (open) => {
			if (!open && !isSubmitting) remove();
		};

		return (
			<AlertDialog open={visible} onOpenChange={onOpenChange}>
				<AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
					<AlertDialogHeader>
						<div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
							<TriangleAlertIcon className="size-5" aria-hidden="true" />
						</div>
						<AlertDialogTitle>{tTitle ? <T id={tTitle} /> : title}</AlertDialogTitle>
						{/* A div: the texts passed in may contain block elements */}
						<AlertDialogDescription asChild>
							<div>
								{children}
								{subject ? (
									<div className="mt-2 font-semibold break-words text-foreground">{subject}</div>
								) : null}
								{details ? (
									<div className="mt-1 text-sm break-words text-muted-foreground">{details}</div>
								) : null}
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					{warning ? <NoticeAlert>{warning}</NoticeAlert> : null}
					<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isSubmitting}>
							<T id="cancel" />
						</AlertDialogCancel>
						{/* Not AlertDialogAction: that closes the dialog before onConfirm has finished */}
						<Button
							type="button"
							color="danger"
							isLoading={isSubmitting}
							disabled={isSubmitting}
							onClick={onSubmit}
						>
							{confirmLabel ?? <T id={tTitle ?? "action.delete"} />}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		);
	},
);

export { showDeleteConfirmModal };
