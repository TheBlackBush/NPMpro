import { cn } from "cn";
import { Fragment, useCallback, useEffect, useMemo, useRef } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import { T } from "src/locale";
import {
	BACKUP_CODE_LENGTH,
	CODE_LENGTH,
	CODE_VALUES,
	codeModeChanges,
	codePattern,
	codeSlotGroups,
	pastedCodeValue,
} from "src/modules/AccountForms";
import { Button } from "src/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "src/ui/input-otp";
import { FormField } from "./FormField";

// six digit boxes in two groups of three; a backup code is eight letters and digits in two groups of four (constants:
// the boxes are drawn again when the groups change)
const CODE_GROUPS = [3, 3];
const BACKUP_GROUPS = [4, 4];

/**
 * A code (by default the six digits of an authenticator app; a backup code uses eight letters and digits) as shadcn's
 * InputOTP: one real input drawn as boxes, so typing moves on, Backspace moves back, a pasted or autofilled code
 * fills every box, and screen readers, password managers and SMS autofill see one ordinary field with its label. A
 * field of the form around it (a controller). A character the code cannot hold is refused (codePattern); a pasted code
 * loses its spaces and dash, and a complete one replaces the value wherever the caret is (pastedCodeValue).
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
	const inputRef = useRef(null);
	const slots = useMemo(() => codeSlotGroups(groups), [groups]);
	const { ref: fieldRef } = field;
	const setRef = useCallback(
		(element) => {
			inputRef.current = element;
			fieldRef(element);
		},
		[fieldRef],
	);
	// InputOTP puts the returned text in at the selection, which it reads after this: the whole value is selected, so
	// the result of pastedCodeValue (the paste at the caret, or a complete code alone) becomes the value
	const pasteTransformer = (text) => {
		const input = inputRef.current;
		if (!input) return text;
		const value = pastedCodeValue(input.value, text, input.selectionStart ?? 0, input.selectionEnd ?? 0, length);
		input.setSelectionRange(0, input.value.length);
		return value;
	};
	return (
		<FormField id={id} label={label} hint={hint} error={error} className={className} ownControl>
			{(control) => (
				<InputOTP
					{...control}
					ref={setRef}
					name={field.name}
					value={field.value}
					onChange={field.onChange}
					onBlur={field.onBlur}
					maxLength={length}
					pattern={codePattern(type).source}
					pasteTransformer={pasteTransformer}
					inputMode={type === "numeric" ? "numeric" : "text"}
					autoComplete={type === "numeric" ? "one-time-code" : "off"}
					autoCapitalize={type === "numeric" ? undefined : "characters"}
					containerClassName="tw:justify-center tw:gap-2"
					required
				>
					{slots.map((group, index) => (
						<Fragment key={group[0]}>
							{index > 0 ? <InputOTPSeparator /> : null}
							<InputOTPGroup>
								{group.map((slot) => (
									<InputOTPSlot
										key={slot}
										index={slot}
										aria-invalid={control["aria-invalid"]}
										className={cn(
											"tw:size-10 tw:text-lg",
											type === "alphanumeric" && "tw:uppercase",
										)}
									/>
								))}
							</InputOTPGroup>
						</Fragment>
					))}
				</InputOTP>
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
		<div className="tw:mb-4">
			{backupShown ? (
				<CodeInput
					key="backup"
					name="backupCode"
					id={`${idPrefix}-backup`}
					label={<T id="mfa.backup-code" />}
					className="tw:mb-2"
					length={BACKUP_CODE_LENGTH}
					type="alphanumeric"
					groups={BACKUP_GROUPS}
				/>
			) : (
				<CodeInput key="code" id={`${idPrefix}-code`} label={label} className="tw:mb-2" />
			)}
			{allowBackup ? (
				<Button
					type="button"
					variant="link"
					className="tw:h-auto tw:p-0"
					onClick={() => switchTo(!backupShown)}
				>
					<T id={backupShown ? "mfa.use-app-code" : "mfa.use-backup-code"} />
				</Button>
			) : null}
		</div>
	);
}

export { CodeEntry, CodeInput, useRefusedCodeReset };
