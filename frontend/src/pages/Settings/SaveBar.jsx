import { useFormState } from "react-hook-form";
import { Button, FormErrorNote, useFocusFirstError } from "src/components";
import { LeaveGuard } from "src/hooks";
import { T } from "src/locale";
import { errorPaths } from "src/modules/HookForm";
import { sectionColor } from "src/modules/SectionColors";

const NOTE_ID = "settings-save-note";
const REASON_ID = "settings-save-reason";

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
	const { isSubmitting, isDirty, errors } = useFormState();
	const focusFirstError = useFocusFirstError();
	const nothingToSave = disabled ?? !isDirty;
	const blocked = errorPaths(errors).length > 0;
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
				color={sectionColor("settings")}
				isLoading={isSubmitting}
				disabled={isSubmitting || (nothingToSave && !blocked)}
				blocked={blocked}
				onBlockedClick={focusFirstError}
				onMouseDown={(e) => e.preventDefault()}
				aria-describedby={blocked ? NOTE_ID : showReason ? REASON_ID : undefined}
			>
				<T id="save" />
			</Button>
		</div>
	);
}

export { SaveBar };
