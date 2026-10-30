import { useEffect, useRef } from "react";
import { useFormState } from "react-hook-form";
import { intl } from "src/locale";

/**
 * Place inside a HookForm, keeps dirtyRef in sync with the form's isDirty
 */
function DirtyTracker({ dirtyRef }) {
	const { isDirty } = useFormState();
	useEffect(() => {
		dirtyRef.current = isDirty;
	}, [isDirty, dirtyRef]);
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
