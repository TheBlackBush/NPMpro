import { useFormikContext } from "formik";
import { useEffect, useRef } from "react";
import { intl } from "src/locale";

/**
 * Place inside a Formik form, keeps dirtyRef in sync with the form's dirty state
 */
function DirtyTracker({ dirtyRef }) {
	const { dirty } = useFormikContext();
	useEffect(() => {
		dirtyRef.current = dirty;
	}, [dirty, dirtyRef]);
	return null;
}

/**
 * Returns a close function that asks before discarding unsaved form changes.
 * Render <DirtyTracker dirtyRef={dirtyRef} /> inside the Formik form.
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
