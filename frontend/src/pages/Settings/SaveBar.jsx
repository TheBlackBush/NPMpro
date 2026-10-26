import { useFormikContext } from "formik";
import { Button, FormErrorNote } from "src/components";
import { LeaveGuard } from "src/hooks";
import { T } from "src/locale";

const NOTE_ID = "settings-save-note";

/**
 * The footer of a settings section: asks before leaving with unsaved changes, and Save. While a field has an error
 * Save looks disabled and the note next to it names the fields to fix (aria-disabled, so it stays reachable and
 * announces the note); disabled (nothing to save, all locked) greys it out completely.
 *
 * @param {Object}  props
 * @param {boolean} [props.disabled]  nothing to save
 * @param {Object}  [props.labels]    field name -> label translation id (FormErrorNote), a stable object
 */
function SaveBar({ disabled = false, labels }) {
	const { isSubmitting, isValid } = useFormikContext();
	return (
		<div className="card-footer d-flex align-items-center justify-content-end">
			<LeaveGuard />
			<FormErrorNote id={NOTE_ID} labels={labels} className="me-3 text-end" />
			<Button
				type="submit"
				color="teal"
				isLoading={isSubmitting}
				disabled={isSubmitting || (disabled && isValid)}
				blocked={!isValid}
				aria-describedby={isValid ? undefined : NOTE_ID}
			>
				<T id="save" />
			</Button>
		</div>
	);
}

export { SaveBar };
