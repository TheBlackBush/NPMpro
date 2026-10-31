import { OtpInput } from "@tabler/core";
import cn from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { T } from "src/locale";
import {
	BACKUP_CODE_LENGTH,
	CODE_LENGTH,
	CODE_VALUES,
	codeModeChanges,
	fittingOtpSize,
	pastedCodeValue,
} from "src/modules/AccountForms";
import { FormField } from "./FormField";

// Tabler's two-step verification page: six digit boxes in two groups of three, large; a backup code is eight letters
// and digits in two groups of four (constants: the boxes are drawn again when the options change)
const CODE_GROUPS = [3, 3];
const BACKUP_GROUPS = [4, 4];
// Tabler's OTP sizes, largest first: the largest that fits the field is used (Tabler has no responsive size)
const OTP_SIZES = [["otp-lg"], [], ["otp-sm"], ["otp-sm", "otp-connected"]];
const OTP_SIZE_CLASSES = ["otp-lg", "otp-sm", "otp-connected"];

/**
 * A code (by default the six digits of an authenticator app; a backup code uses eight letters and digits) as Tabler's
 * OTP input (its two-step verification pattern): one real input that Tabler draws as boxes, so typing moves on,
 * Backspace moves back, a pasted or autofilled code fills every box, and screen readers, password managers and SMS
 * autofill see one ordinary field with its label. A field of the form around it (a controller): Tabler's input event
 * sets the value, a new value (an emptied code) redraws the boxes. The boxes use the largest of Tabler's sizes that
 * fits the width of the field (large, default, small, small and connected), also when the window is resized.
 *
 * @param {Object}   props
 * @param {string}   [props.name]       "code" by default
 * @param {number}   [props.length]     boxes, CODE_LENGTH by default
 * @param {string}   [props.type]       "numeric" (default) or "alphanumeric" (shown in capitals)
 * @param {number[]} [props.groups]     boxes per group, [3, 3] by default (keep the array stable between renders)
 * @param {string}   props.id
 * @param {*}        props.label
 * @param {*}        [props.hint]
 * @param {string}   [props.className]  of the field
 */
function CodeInput({
	name = "code",
	id,
	label,
	hint,
	className,
	length = CODE_LENGTH,
	type = "numeric",
	groups = CODE_GROUPS,
}) {
	const { field, fieldState } = useController({ name });
	const error = fieldState.error?.message ?? null;
	const wrapperRef = useRef(null);
	const onChangeRef = useRef(field.onChange);
	useLayoutEffect(() => {
		onChangeRef.current = field.onChange;
	});
	// the values typed that the form has not shown yet: a render of an older one is not a new value to draw (an entry
	// that is never matched is dropped by the next value that is not typed, so a stale one does no harm)
	const typedRef = useRef([]);
	const emit = useCallback((value) => {
		typedRef.current.push(value);
		onChangeRef.current(value);
	}, []);
	// before the first paint, so the boxes never show in a size that overflows
	useLayoutEffect(() => {
		const wrapper = wrapperRef.current;
		const otp = OtpInput.getOrCreateInstance(wrapper, { length, type, groups });
		const onInput = (event) => emit(event.value);
		wrapper.addEventListener("input.bs.otpInput", onInput);
		// the boxes in each size are measured in turn (nothing is painted between), the largest that fits is kept
		const fit = () => {
			const slots = wrapper.querySelector(".otp-slots");
			if (!slots) return;
			const widthOf = (size) => {
				wrapper.classList.remove(...OTP_SIZE_CLASSES);
				wrapper.classList.add(...size);
				return slots.getBoundingClientRect().width;
			};
			const size = fittingOtpSize(OTP_SIZES, widthOf, wrapper.parentElement.clientWidth);
			wrapper.classList.remove(...OTP_SIZE_CLASSES);
			wrapper.classList.add(...size);
		};
		fit();
		// a resize is answered in the next frame: a size switch that changes the container's height then never runs
		// inside the observer's own delivery (no "ResizeObserver loop" warning)
		let frame = 0;
		const observer = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(fit);
		});
		observer.observe(wrapper.parentElement);
		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			wrapper.removeEventListener("input.bs.otpInput", onInput);
			otp.dispose();
		};
	}, [length, type, groups, emit]);
	useEffect(() => {
		const otp = OtpInput.getInstance(wrapperRef.current);
		const typed = typedRef.current.indexOf(field.value);
		if (typed >= 0) {
			typedRef.current.splice(0, typed + 1);
			return;
		}
		typedRef.current = [];
		if (otp && otp.getValue() !== field.value) otp.setValue(field.value);
	}, [field.value]);
	// a pasted code: the paste is handled here (preventDefault), as the browser would cut the text at maxlength before
	// Tabler's setValue drops what a code does not hold (the dash of "ABCD-1234"); a complete code replaces the value
	const onPaste = (event) => {
		const otp = OtpInput.getInstance(wrapperRef.current);
		if (!otp) return;
		event.preventDefault();
		const input = event.currentTarget;
		const { value, selectionStart, selectionEnd } = input;
		otp.setValue(pastedCodeValue(value, event.clipboardData.getData("text"), selectionStart, selectionEnd, length));
		emit(otp.getValue());
		otp.focus();
	};
	// the red boxes: set on the element, as Tabler adds its own class (otp-rendered) that a className from React
	// would remove
	useEffect(() => {
		wrapperRef.current.classList.toggle("is-invalid", Boolean(error));
	}, [error]);
	return (
		<FormField id={id} label={label} hint={hint} error={error} className={className}>
			{(control) => (
				<div className="d-flex justify-content-center">
					<div ref={wrapperRef} className={cn("otp", type === "alphanumeric" && "text-uppercase")}>
						<input
							{...control}
							ref={field.ref}
							name={field.name}
							type="text"
							defaultValue={field.value}
							onBlur={field.onBlur}
							onPaste={onPaste}
							inputMode={type === "numeric" ? "numeric" : "text"}
							autoComplete={type === "numeric" ? "one-time-code" : "off"}
							autoCapitalize={type === "numeric" ? undefined : "characters"}
							spellCheck={type === "numeric" ? undefined : false}
							maxLength={length}
							required
						/>
					</div>
				</div>
			)}
		</FormField>
	);
}

/**
 * For the code forms (useAppForm with keepEdits false, so the reset takes the empty values): starts a refused code
 * over. Call the returned function from the submit handler when the code was refused (with the form's useBackup);
 * once the submit has finished, the form is reset (the boxes are empty, the form is no longer submitted, so no
 * message shows until the new code is left or sent) and the focus goes back to the boxes. React Hook Form marks the
 * form submitted only after the submit handler returns, so a reset inside the handler would be undone; its
 * documentation resets after the submit, on submitCount.
 *
 * @param   {Object}   methods  of useAppForm
 * @returns {Function} (useBackup: boolean) => void
 */
function useRefusedCodeReset(methods) {
	const { reset, setFocus } = methods;
	const { submitCount } = methods.formState;
	const refused = useRef(null);
	useEffect(() => {
		if (submitCount === 0 || !refused.current) return;
		const { useBackup } = refused.current;
		refused.current = null;
		reset({ ...CODE_VALUES, useBackup }, { keepIsSubmitted: false, keepSubmitCount: false });
		setFocus(useBackup ? "backupCode" : "code");
	}, [submitCount, reset, setFocus]);
	return useCallback((useBackup) => {
		refused.current = { useBackup };
	}, []);
}

/**
 * The code of a second factor (the fields code, backupCode and useBackup of the form around it, CODE_VALUES): the
 * six boxes or, after "Use a backup code", eight boxes for a backup code. The switch shows
 * the other field empty, drops both messages and puts the focus in it. As on Tabler's two-step verification page,
 * the only field of its form carries no required asterisk.
 *
 * @param {Object}  props
 * @param {string}  props.idPrefix
 * @param {*}       props.label         of the six boxes
 * @param {boolean} [props.allowBackup]  offer "Use a backup code" (sign in, turning two-factor off)
 */
function CodeEntry({ idPrefix, label, allowBackup = false }) {
	const { setValue, clearErrors, setFocus } = useFormContext();
	const useBackup = useWatch({ name: "useBackup" });
	const switched = useRef(false);
	useEffect(() => {
		if (!switched.current) return;
		switched.current = false;
		setFocus(useBackup ? "backupCode" : "code");
	}, [useBackup, setFocus]);
	const switchTo = (backup) => {
		for (const [key, value] of Object.entries(codeModeChanges(backup))) setValue(key, value);
		clearErrors(["code", "backupCode"]);
		switched.current = true;
	};
	const backupShown = allowBackup && useBackup;
	return (
		<div className="mb-3">
			{backupShown ? (
				<CodeInput
					key="backup"
					name="backupCode"
					id={`${idPrefix}-backup`}
					label={<T id="mfa.backup-code" />}
					className="mb-2"
					length={BACKUP_CODE_LENGTH}
					type="alphanumeric"
					groups={BACKUP_GROUPS}
				/>
			) : (
				<CodeInput key="code" id={`${idPrefix}-code`} label={label} className="mb-2" />
			)}
			{allowBackup ? (
				<button type="button" className="btn btn-link p-0" onClick={() => switchTo(!backupShown)}>
					<T id={backupShown ? "mfa.use-app-code" : "mfa.use-backup-code"} />
				</button>
			) : null}
		</div>
	);
}

export { CodeEntry, CodeInput, useRefusedCodeReset };
