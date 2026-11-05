import { useModal } from "@ebay/nice-modal-react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "src/components";
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

/**
 * Asks whether unsaved changes may be discarded (closing a window, leaving a settings section). Resolves true when the
 * user discards them, false when they keep editing (the button, Escape); the focus returns to what opened the prompt.
 *
 * @param {string} messageId translation key of the question
 * @returns {Promise<boolean>}
 */
const askDiscard = (messageId) => EasyModal.show(DiscardChangesModal, { messageId });

const DiscardChangesModal = EasyModal.create(({ messageId, visible }) => {
	const modal = useModal();
	const answer = (discard) => {
		modal.resolve(discard);
		void modal.remove();
	};
	return (
		<AlertDialog open={visible} onOpenChange={(open) => !open && answer(false)}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<div className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
						<TriangleAlertIcon className="size-5" aria-hidden="true" />
					</div>
					<AlertDialogTitle>
						<T id="unsaved-changes.title" />
					</AlertDialogTitle>
					<AlertDialogDescription>
						<T id={messageId} />
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>
						<T id="unsaved-changes.keep" />
					</AlertDialogCancel>
					{/* Not AlertDialogAction: the answer is resolved here before the window goes */}
					<Button color="danger" onClick={() => answer(true)}>
						<T id="unsaved-changes.discard" />
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
});

export { askDiscard };
