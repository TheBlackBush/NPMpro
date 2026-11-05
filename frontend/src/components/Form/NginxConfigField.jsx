import { useFormContext, useWatch } from "react-hook-form";
import { Field, FieldDescription, FieldLabel } from "src/components/ui/field";
import { Textarea } from "src/components/ui/textarea";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";
import { useReadOnly } from "./HookForm";

/**
 * Raw nginx config is admin-only: other users see a stored value read-only and, when it is empty, a hint that the
 * config is for administrators. Read-only, not disabled, also in a View window (keep its TabPane selfReadOnly): the
 * value can be focused, selected and scrolled by keyboard, but not changed. A window with two of these fields passes
 * emptyHint={false} to both and shows the hint once itself when both are empty.
 *
 * @param {Object}  props
 * @param {string}  [props.name]       the form field
 * @param {string}  [props.label]      the translation id of the label
 * @param {string}  [props.id]         the textarea id
 * @param {string}  [props.hint]       the translation id of a hint under the textarea, shown to every user; for a
 *                                     non-admin the admin-only hint follows it
 * @param {boolean} [props.emptyHint]  show the admin-only hint in place of an empty field for a non-admin; when false
 *                                     the empty field renders nothing
 */
export function NginxConfigField({
	name = "advancedConfig",
	label = "nginx-config.label",
	id = "advancedConfig",
	hint,
	emptyHint = true,
}) {
	const isAdmin = useIsAdmin();
	const viewOnly = useReadOnly();
	const { register } = useFormContext();
	const value = useWatch({ name });
	if (!isAdmin && !value?.trim()) {
		return emptyHint ? (
			<div className="my-3 text-center text-muted-foreground">
				<T id="nginx-config.admin-only" />
			</div>
		) : null;
	}
	const describedBy = [hint && `${id}-hint`, !isAdmin && `${id}-admin-hint`].filter(Boolean);
	return (
		<Field className="mt-3">
			<FieldLabel htmlFor={id}>
				<T id={label} />
			</FieldLabel>
			<Textarea
				id={id}
				// fixed rows the user can stretch, not the auto-growing default of Textarea
				className="field-sizing-fixed min-h-24 resize-y font-mono"
				spellCheck={false}
				placeholder={intl.formatMessage({ id: "nginx-config.placeholder" })}
				rows={9}
				readOnly={!isAdmin || viewOnly}
				aria-describedby={describedBy.length ? describedBy.join(" ") : undefined}
				{...register(name)}
			/>
			{hint && (
				<FieldDescription id={`${id}-hint`}>
					<T id={hint} />
				</FieldDescription>
			)}
			{!isAdmin && (
				<FieldDescription id={`${id}-admin-hint`}>
					<T id="nginx-config.admin-only" />
				</FieldDescription>
			)}
		</Field>
	);
}
