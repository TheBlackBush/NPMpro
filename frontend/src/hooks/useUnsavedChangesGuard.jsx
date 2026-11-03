import { useEffect, useRef } from "react";
import { useFormState } from "react-hook-form";
import { usePendingEntries } from "src/components/Form/HookForm";
import { intl } from "src/locale";

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
	const close = () => {
		// biome-ignore lint/suspicious/noAlert: a blocking confirm is enough for this guard
		if (dirtyRef.current && !window.confirm(intl.formatMessage({ id: "unsaved-changes.confirm" }))) return;
		remove();
	};
	return { dirtyRef, close };
};

export { DirtyTracker, useUnsavedChangesGuard };
