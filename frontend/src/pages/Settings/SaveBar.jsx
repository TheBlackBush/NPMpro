import { useFormikContext } from "formik";
import { useFormContext, useFormState } from "react-hook-form";
import { Button, FormErrorNote, focusFirstError, showFirstInvalid, useFieldOrder } from "src/components";
import { LeaveGuard } from "src/hooks";
import { T } from "src/locale";
import { errorPaths } from "src/modules/HookForm";

const NOTE_ID = "settings-save-note";
const REASON_ID = "settings-save-reason";

// the footer for the state of either form library
function SaveBarLayout({ nothingToSave, reasonId, labels, isSubmitting, blocked, onBlocked }) {
	const showReason = nothingToSave && !blocked && !isSubmitting;
	return (
		<div className="card-footer d-flex align-items-center justify-content-end">
			<LeaveGuard />
			<FormErrorNote id={NOTE_ID} labels={labels} className="me-3 text-end" />
			{showReason ? (
				<span id={REASON_ID} className="text-secondary small me-3 text-end">
					<T id={reasonId} />
				</span>
			) : null}
			<Button
				type="submit"
				color="teal"
				isLoading={isSubmitting}
				disabled={isSubmitting || (nothingToSave && !blocked)}
				blocked={blocked}
				onBlockedClick={(e) => onBlocked(e.currentTarget.closest("form"))}
				onMouseDown={(e) => e.preventDefault()}
				aria-describedby={blocked ? NOTE_ID : showReason ? REASON_ID : undefined}
			>
				<T id="save" />
			</Button>
		</div>
	);
}

function FormikSaveBar({ disabled, ...props }) {
	const { isSubmitting, isValid, dirty } = useFormikContext();
	return (
		<SaveBarLayout
			{...props}
			nothingToSave={disabled ?? !dirty}
			isSubmitting={isSubmitting}
			blocked={!isValid}
			onBlocked={showFirstInvalid}
		/>
	);
}

function HookFormSaveBar({ disabled, ...props }) {
	const { setFocus } = useFormContext();
	const { isSubmitting, isDirty, errors } = useFormState();
	const order = useFieldOrder();
	return (
		<SaveBarLayout
			{...props}
			nothingToSave={disabled ?? !isDirty}
			isSubmitting={isSubmitting}
			blocked={errorPaths(errors).length > 0}
			onBlocked={(form) => focusFirstError(form, errors, order, setFocus)}
		/>
	);
}

/**
 * The footer of a settings section: asks before leaving with unsaved changes, and Save. Save never looks unavailable
 * without saying why: while a field has an error it looks disabled and the red note names the fields to fix
 * (aria-disabled, so it stays reachable and announces the note); when there is nothing to save it is disabled and a
 * grey note says why.
 *
 * @param {Object}  props
 * @param {boolean} [props.disabled]   nothing to save (default: the form has no changes)
 * @param {string}  [props.reasonId]   why it is disabled (translation id), default "no changes"
 * @param {Object}  [props.labels]     field name -> label translation id (FormErrorNote), a stable object
 */
function SaveBar({ disabled, reasonId = "form.no-changes", labels }) {
	const props = { disabled, reasonId, labels };
	// the Formik branch goes once every section is on React Hook Form
	return useFormContext() ? <HookFormSaveBar {...props} /> : <FormikSaveBar {...props} />;
}

export { SaveBar };
