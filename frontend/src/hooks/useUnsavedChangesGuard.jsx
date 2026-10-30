import { useFormikContext } from "formik";
import { useEffect, useRef } from "react";
import { useFormContext, useFormState } from "react-hook-form";
import { intl } from "src/locale";

function FormikDirtyTracker({ dirtyRef }) {
	const { dirty } = useFormikContext();
	useEffect(() => {
		dirtyRef.current = dirty;
	}, [dirty, dirtyRef]);
	return null;
}

function HookFormDirtyTracker({ dirtyRef }) {
	const { isDirty } = useFormState();
	useEffect(() => {
		dirtyRef.current = isDirty;
	}, [isDirty, dirtyRef]);
	return null;
}

/**
 * Place inside a form, keeps dirtyRef in sync with the form's dirty state (React Hook Form's isDirty, or Formik's
 * dirty; A3 removes the Formik branch)
 */
function DirtyTracker({ dirtyRef }) {
	return useFormContext() ? <HookFormDirtyTracker dirtyRef={dirtyRef} /> : <FormikDirtyTracker dirtyRef={dirtyRef} />;
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
