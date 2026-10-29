import { createContext, useContext, useEffect, useRef, useState } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { errorPaths, fieldPaths, formResolver, orderErrorPaths } from "src/modules/HookForm";

const FieldOrderContext = createContext([]);

/**
 * useForm for the app's forms: the window's validate function (values => errors of translated messages; the newest
 * one, so it may use data loaded later) as the resolver; an error shows once its field was left and then follows each
 * change, after a save every error shows (onTouched, reValidate onChange); HookForm focuses the first error in the
 * form's field order. A field whose message depends on another one is re-checked through that field's deps option
 * (register(name, { deps: [...] }), or rules: { deps: [...] } on a controller).
 *
 * @param   {Object}   options
 * @param   {Object}   options.defaultValues  every field of the form, none undefined (isDirty compares with them)
 * @param   {Object}   [options.values]       loaded values (a query's data): they become the defaultValues once
 *                                            they arrive; fields the user already changed are kept
 * @param   {Function} [options.validate]     (values) => errors
 * @returns {Object}   useForm's methods
 */
function useAppForm({ defaultValues, values, validate }) {
	const validateRef = useRef(validate);
	useEffect(() => {
		validateRef.current = validate;
	});
	const [resolver] = useState(() => formResolver((formValues) => validateRef.current?.(formValues) ?? {}));
	return useForm({
		defaultValues,
		values,
		resetOptions: { keepDirtyValues: true },
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
	// a field on a hidden tab: show the tab first (first exercised in A2, the windows with tabs)
	const control = form?.querySelector(`[name="${CSS.escape(first)}"]`);
	const pane = control?.closest(".tab-pane:not(.active)");
	if (pane) form.querySelector(`[data-bs-toggle="tab"][href="#${pane.id}"]`)?.click();
	setFocus(first);
}

/**
 * The <form> of a React Hook Form form (the same element Formik's Form rendered: action "#", noValidate, the
 * submit stays inside) with the methods for useFormContext; a refused save focuses the first error. A second submit
 * (Enter again) while a save runs is ignored, as React Hook Form does not block it.
 *
 * @param {Object}   props
 * @param {Object}   props.methods       useAppForm's result
 * @param {Function} props.onSubmit      async (values) => void, the save (isSubmitting lasts until it settles)
 * @param {string[]} [props.fieldOrder]  the fields in form order, when the defaultValues' order differs
 * @param {*}        props.children
 */
function HookForm({ methods, onSubmit, fieldOrder, children }) {
	const [order] = useState(() => fieldOrder ?? fieldPaths(methods.formState.defaultValues));
	const submitting = useRef(false);
	return (
		<FormProvider {...methods}>
			<FieldOrderContext.Provider value={order}>
				<form
					action="#"
					noValidate
					onSubmit={(event) => {
						event.stopPropagation();
						if (submitting.current) {
							event.preventDefault();
							return;
						}
						submitting.current = true;
						const form = event.currentTarget;
						void methods
							.handleSubmit(onSubmit, (errors) => focusFirstError(form, errors, order, methods.setFocus))(
								event,
							)
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

export { focusFirstError, HookForm, useAppForm, useFieldOrder };
