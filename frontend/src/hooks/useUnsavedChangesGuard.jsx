import { useEffect, useRef } from "react";
import { useFormState } from "react-hook-form";
import { usePendingEntries } from "src/components/Form/HookForm";
import { askDiscard } from "src/modals/DiscardChangesModal";

/**
 * Place inside a HookForm, keeps dirtyRef in sync with the form's isDirty; typed text that is not a value yet (a
 * domain name without Enter) counts as a change too
 */
function DirtyTracker({ dirtyRef }) {
	const { isDirty } = useFormState();
	const pending = usePendingEntries().size > 0;
	useEffect(() => {
		dirtyRef.current = isDirty || pending;
	}, [isDirty, pending, dirtyRef]);
	return null;
}

/**
 * Returns a close function that asks before discarding unsaved form changes.
 * Render <DirtyTracker dirtyRef={dirtyRef} /> inside the form.
 */
const useUnsavedChangesGuard = (remove) => {
	const dirtyRef = useRef(false);
	const close = async () => {
		if (dirtyRef.current && !(await askDiscard("unsaved-changes.confirm"))) return;
		remove();
	};
	return { dirtyRef, close };
};

export { DirtyTracker, useUnsavedChangesGuard };
