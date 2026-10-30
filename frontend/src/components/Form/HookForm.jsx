import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FormProvider, get, useForm, useFormContext, useFormState } from "react-hook-form";
import {
	controlNames,
	errorPaths,
	fieldPaths,
	formResolver,
	orderErrorPaths,
	resetOptionsOf,
	rowErrorPaths,
} from "src/modules/HookForm";

const FieldOrderContext = createContext([]);

/**
 * useForm for the app's forms: the window's validate function (values => errors of translated messages; the newest
 * one, so it may use data loaded later) as the resolver; an error shows once its field was left and then follows each
 * change, after a save every error shows (onTouched, reValidate onChange); HookForm focuses the first error in the
 * form's field order. A field whose message depends on another one is re-checked with useRecheckDependent.
 *
 * @param   {Object}   options
 * @param   {Object}   options.defaultValues  every field of the form, none undefined (isDirty compares with them)
 * @param   {Object}   [options.values]       loaded values (a query's data): they become the defaultValues once
 *                                            they arrive (and whenever they change)
 * @param   {Function} [options.validate]     (values) => errors
 * @param   {boolean}  [options.keepEdits]    when new values arrive or reset() runs, keep the fields the user
 *                                            already changed (default); false: every field takes the new values
 *                                            (as a Settings section shows the saved settings again after its save,
 *                                            or a form empties its field after a refused code) and the form stays
 *                                            submitted
 * @returns {Object}   useForm's methods
 */
function useAppForm({ defaultValues, values, validate, keepEdits = true }) {
	const validateRef = useRef(validate);
	// before any event handler runs, so the resolver always uses the validate of the last render
	useLayoutEffect(() => {
		validateRef.current = validate;
	}, [validate]);
	const [resolver] = useState(() => formResolver((formValues) => validateRef.current?.(formValues) ?? {}));
	return useForm({
		defaultValues,
		values,
		resetOptions: resetOptionsOf(keepEdits),
		resolver,
		mode: "onTouched",
		reValidateMode: "onChange",
		// HookForm focuses the first error in field order; React Hook Form's own focus follows registration order,
		// where fields with register() come before controllers
		shouldFocusError: false,
	});
}

/**
 * The fields of the form around the caller, in form order (HookForm's fieldOrder or its defaultValues)
 *
 * @returns {string[]}
 */
function useFieldOrder() {
	return useContext(FieldOrderContext);
}

/**
 * Re-checks a field whose message depends on another field (a repeat field, the credential of a DNS provider): call
 * the returned function from the other field's change handler (register's onChange option, or after field.onChange
 * in a controller). It triggers name only when name's message may already show: name was left, has a message, or a
 * save was tried. So leaving the other field (Tab to name) shows nothing on name yet. React Hook Form's deps option
 * is not used, as it also fires when the other field is left (blur), before name was visited.
 *
 * @param   {string}   name  the dependent field
 * @returns {Function} () => void
 */
function useRecheckDependent(name) {
	const { trigger, getFieldState } = useFormContext();
	// read during render, so this component re-renders when they change (React Hook Form's subscription)
	const formState = useFormState({ name, exact: true });
	const { isSubmitted } = formState;
	const { isTouched, error } = getFieldState(name, formState);
	return () => {
		if (isTouched || error || isSubmitted) void trigger(name);
	};
}

/**
 * The message a field shows (React Hook Form's errors: once the field was left, or after a save was tried), for the
 * form layer's fields; nested names work too ("fieldValues.token")
 *
 * @param   {string} name
 * @returns {string|null}
 */
function useFieldError(name) {
	// only this field's errors are read, so the field re-renders when its error changes, not on its dirty, touched or
	// validating state (React Hook Form subscribes to what is read from formState)
	const { errors } = useFormState({ name, exact: true });
	return get(errors, name)?.message ?? null;
}

/**
 * Focuses the first field with an error in field order: opens the tab that holds it, then setFocus
 *
 * @param {HTMLFormElement|null} form
 * @param {Object}   errors    React Hook Form's errors
 * @param {string[]} order     useFieldOrder()
 * @param {Function} setFocus  React Hook Form's setFocus
 */
function focusFirstError(form, errors, order, setFocus) {
	const [first] = orderErrorPaths(errorPaths(errors), order);
	if (!first) return;
	// a field on a hidden tab: show the tab first; a list row's control is named locations.0.path, its error
	// path is locations[0].path
	const control = controlNames(first)
		.map((name) => form?.querySelector(`[name="${CSS.escape(name)}"]`))
		.find(Boolean);
	const pane = control?.closest(".tab-pane:not(.active)");
	if (pane) form.querySelector(`[data-bs-toggle="tab"][href="#${pane.id}"]`)?.click();
	setFocus(first);
}

/**
 * For a button that is blocked while a message shows: checks the whole form (handleSubmit, which saves nothing here)
 * and focuses the first error in field order. Only the fields left so far show a message, so the messages on screen
 * may not hold the first one in the page (Enter in the ACME profile with the renewal interval already refused):
 * the click handler gets the same answer as a save would.
 *
 * @returns {Function} (event) => void, for onBlockedClick
 */
function useFocusFirstError() {
	const { handleSubmit, setFocus } = useFormContext();
	const order = useFieldOrder();
	return (event) => {
		const form = event.currentTarget.closest("form");
		void handleSubmit(
			() => undefined,
			(errors) => focusFirstError(form, errors, order, setFocus),
		)();
	};
}

/**
 * After a save that keeps the window open (saved, but the nginx config needs fixing): call the returned function
 * inside the save handler once the save succeeded (the API answered), not before it and not when it failed. It
 * arms the reset; once handleSubmit has settled (isSubmitting drops), the current values become the starting values
 * (nothing to save, no messages, no refused save), as Formik's resetForm({ values }) did; list rows keep their keys.
 * React Hook Form marks the form submitted when handleSubmit ends, so the reset waits for that (the documented reset
 * after a submit).
 *
 * @param   {Object}   methods  useAppForm's result
 * @returns {Function} () => void
 */
function useResetToSaved(methods) {
	const [pending, setPending] = useState(false);
	const { isSubmitting } = useFormState({ control: methods.control });
	useEffect(() => {
		if (!pending || isSubmitting) return;
		setPending(false);
		methods.reset(methods.getValues(), { keepValues: true });
	}, [pending, isSubmitting, methods]);
	return () => setPending(true);
}

/**
 * The checks of a list (useFieldArray) after a change that concerns more than one row. afterRemove: the rows
 * shifted, so before a save was tried the list's messages go (they come back once a field is left, as the Formik
 * lists cleared their touched rows), after a refused save the list is checked again. recheckRows(field): a value the
 * other rows are compared with changed (a duplicate path or username), so the rows showing a message for that field
 * are checked again.
 *
 * @param   {string} name  the list
 * @returns {{ afterRemove: Function, recheckRows: Function }}
 */
function useListRecheck(name) {
	const { trigger, clearErrors, getFieldState } = useFormContext();
	// isSubmitted and the list's errors are read during render: useFormState only updates (and re-renders the caller
	// for) the keys its proxy saw read in a render, so a first read inside a handler would see a stale snapshot
	const formState = useFormState({ name });
	const { isSubmitted } = formState;
	const listError = getFieldState(name, formState).error;
	return {
		afterRemove: () => {
			if (isSubmitted) void trigger(name);
			else clearErrors(name);
		},
		recheckRows: (field) => {
			const paths = rowErrorPaths(listError, name, field);
			if (paths.length > 0) void trigger(paths);
		},
	};
}

/**
 * The <form> of a React Hook Form form (the same element Formik's Form rendered: action "#", noValidate, the
 * submit stays inside) with the methods for useFormContext; a refused save focuses the first error. A second submit
 * (Enter again) while a save runs is ignored, as React Hook Form does not block it.
 *
 * @param {Object}   props
 * @param {Object}   props.methods       useAppForm's result
 * @param {Function} props.onSubmit      async (values) => void, the save (isSubmitting lasts until it settles)
 * @param {string[]} [props.fieldOrder]  the fields in form order, when the defaultValues' order differs; read once,
 *                                      on the first render (as the defaultValues' order)
 * @param {string}   [props.className]   of the <form>
 * @param {*}        props.children
 */
function HookForm({ methods, onSubmit, fieldOrder, className, children }) {
	const [order] = useState(() => fieldOrder ?? fieldPaths(methods.formState.defaultValues));
	const submitting = useRef(false);
	const formRef = useRef(null);
	// a refused save focuses the first error once the page shows the messages (a list row with an error opens then).
	// The errors are the ones handleSubmit hands to onInvalid: methods.formState is a snapshot of the root's state,
	// which React Hook Form only updates for the keys the root read during render
	const [refused, setRefused] = useState(null);
	useLayoutEffect(() => {
		if (refused) focusFirstError(formRef.current, refused.errors, order, methods.setFocus);
	}, [refused, methods, order]);
	return (
		<FormProvider {...methods}>
			<FieldOrderContext.Provider value={order}>
				<form
					ref={formRef}
					className={className}
					action="#"
					noValidate
					onSubmit={(event) => {
						event.stopPropagation();
						if (submitting.current) {
							event.preventDefault();
							return;
						}
						submitting.current = true;
						void methods
							.handleSubmit(onSubmit, (errors) => setRefused({ errors }))(event)
							.finally(() => {
								submitting.current = false;
							});
					}}
				>
					{children}
				</form>
			</FieldOrderContext.Provider>
		</FormProvider>
	);
}

export {
	focusFirstError,
	HookForm,
	useAppForm,
	useFieldError,
	useFieldOrder,
	useFocusFirstError,
	useListRecheck,
	useRecheckDependent,
	useResetToSaved,
};
