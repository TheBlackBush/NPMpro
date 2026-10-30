import { OtpInput } from "@tabler/core";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { T } from "src/locale";
import { BACKUP_CODE_LENGTH, CODE_LENGTH, codeModeChanges } from "src/modules/AccountForms";
import { FormField } from "./FormField";

// Tabler's two-step verification page: six digit boxes in two groups of three, large; a backup code is eight letters
// and digits in two groups of four (constants: the boxes are drawn again when the options change)
const CODE_GROUPS = [3, 3];
const BACKUP_GROUPS = [4, 4];
// what a code is often written with and Tabler's boxes drop: spaces and dashes
const PASTE_SEPARATORS = /[\s-]/gu;

/**
 * A code (by default the six digits of an authenticator app; a backup code uses eight letters and digits) as Tabler's
 * OTP input (its two-step verification pattern): one real input that Tabler draws as boxes, so typing moves on, Backspace moves back, a pasted or autofilled code fills every
 * box, and screen readers, password managers and SMS autofill see one ordinary field with its label. A field of the
 * form around it (a controller): Tabler's input event sets the value, a new value (an emptied code) redraws the
 * boxes.
 *
 * @param {Object}   props
 * @param {string}   [props.name]       "code" by default
 * @param {number}   [props.length]     boxes, CODE_LENGTH by default
 * @param {string}   [props.type]       "numeric" (default) or "alphanumeric"
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
	// the values typed that the form has not shown yet: a render of an older one is not a new value to draw
	const typedRef = useRef([]);
	const emit = useCallback((value) => {
		typedRef.current.push(value);
		onChangeRef.current(value);
	}, []);
	useEffect(() => {
		const wrapper = wrapperRef.current;
		const otp = OtpInput.getOrCreateInstance(wrapper, { length, type, groups });
		const onInput = (event) => emit(event.value);
		wrapper.addEventListener("input.bs.otpInput", onInput);
		return () => {
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
	// a pasted code: the browser cuts the text at the length before Tabler drops the spaces and dashes of "ABCD-1234",
	// so they are dropped first
	const onPaste = (event) => {
		const otp = OtpInput.getInstance(wrapperRef.current);
		if (!otp) return;
		event.preventDefault();
		const input = event.currentTarget;
		const text = event.clipboardData.getData("text").replace(PASTE_SEPARATORS, "");
		const { value, selectionStart, selectionEnd } = input;
		otp.setValue(value.slice(0, selectionStart) + text + value.slice(selectionEnd));
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
				<div ref={wrapperRef} className="otp otp-lg">
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
			)}
		</FormField>
	);
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

export { CodeEntry, CodeInput };
