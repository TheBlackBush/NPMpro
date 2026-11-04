import { REGEXP_ONLY_DIGITS, REGEXP_ONLY_DIGITS_AND_CHARS } from "input-otp";
import { Fragment, useCallback, useEffect, useRef } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { Button } from "src/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "src/components/ui/input-otp";
import { T } from "src/locale";
import {
	BACKUP_CODE_LENGTH,
	CODE_LENGTH,
	CODE_VALUES,
	codeModeChanges,
	pastedCodeValue,
} from "src/modules/AccountForms";
import { FormField } from "./FormField";

// two groups of three boxes for the six digits of an app code, two groups of four for a backup code (constants: keep
// the array stable between renders)
const CODE_GROUPS = [3, 3];
const BACKUP_GROUPS = [4, 4];

/**
 * A code (by default the six digits of an authenticator app; a backup code uses eight letters and digits) as shadcn's
 * input-otp: one real input that is drawn as boxes, so typing moves on, Backspace moves back, a pasted or autofilled
 * code fills every box, and screen readers, password managers and SMS autofill see one ordinary field with its label.
 * A field of the form around it (a controller). A paste is handled here: spaces and dashes are dropped
 * ("ABCD-1234"), a complete code replaces the whole value wherever the caret is. The boxes shrink on narrow screens.
 *
 * @param {Object}   props
 * @param {string}   [props.name]       "code" by default
 * @param {number}   [props.length]     boxes, CODE_LENGTH by default
 * @param {string}   [props.type]       "numeric" (default) or "alphanumeric" (shown in capitals)
 * @param {number[]} [props.groups]     boxes per group, [3, 3] by default (their sum is length)
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
	const numeric = type === "numeric";
	const pattern = numeric ? REGEXP_ONLY_DIGITS : REGEXP_ONLY_DIGITS_AND_CHARS;
	const shown = (value) => (numeric ? value : value.toUpperCase());
	// capture phase, so it runs before input-otp's own paste handling (which on iOS would paste the text as it is)
	const onPasteCapture = (event) => {
		event.preventDefault();
		event.stopPropagation();
		const { value, selectionStart, selectionEnd } = event.currentTarget;
		const text = event.clipboardData.getData("text");
		const next = shown(pastedCodeValue(value, text, selectionStart, selectionEnd, length)).slice(0, length);
		if (next.length > 0 && new RegExp(pattern).test(next)) field.onChange(next);
	};
	const starts = groups.map((_, group) => groups.slice(0, group).reduce((sum, size) => sum + size, 0));
	return (
		<FormField id={id} label={label} hint={hint} error={error} className={className}>
			{(control) => (
				<div className="flex justify-center">
					<InputOTP
						{...control}
						noScriptCSSFallback={null}
						ref={field.ref}
						name={field.name}
						maxLength={length}
						pattern={pattern}
						value={field.value}
						onChange={(value) => field.onChange(shown(value))}
						onBlur={field.onBlur}
						onPasteCapture={onPasteCapture}
						inputMode={numeric ? "numeric" : "text"}
						autoComplete={numeric ? "one-time-code" : "off"}
						autoCapitalize={numeric ? undefined : "characters"}
					>
						{groups.map((size, group) => (
							<Fragment key={starts[group]}>
								{group > 0 ? <InputOTPSeparator /> : null}
								<InputOTPGroup>
									{Array.from({ length: size }, (_, index) => (
										<InputOTPSlot
											key={starts[group] + index}
											index={starts[group] + index}
											aria-invalid={control["aria-invalid"]}
											className="size-9 text-lg min-[400px]:size-11"
										/>
									))}
								</InputOTPGroup>
							</Fragment>
						))}
					</InputOTP>
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
		// keepFieldsRef: a plain reset forgets the registered fields, and setFocus would find nothing to focus
		reset({ ...CODE_VALUES, useBackup }, { keepIsSubmitted: false, keepSubmitCount: false, keepFieldsRef: true });
		setFocus(useBackup ? "backupCode" : "code");
	}, [submitCount, reset, setFocus]);
	return useCallback((useBackup) => {
		refused.current = { useBackup };
	}, []);
}

/**
 * The code of a second factor (the fields code, backupCode and useBackup of the form around it, CODE_VALUES): the
 * six boxes or, after "Use a backup code", eight boxes for a backup code. The switch shows
 * the other field empty, drops both messages and puts the focus in it. As on a two-step verification page,
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
				<Button type="button" variant="link" className="h-auto p-0" onClick={() => switchTo(!backupShown)}>
					<T id={backupShown ? "mfa.use-app-code" : "mfa.use-backup-code"} />
				</Button>
			) : null}
		</div>
	);
}

export { CodeEntry, CodeInput, useRefusedCodeReset };
