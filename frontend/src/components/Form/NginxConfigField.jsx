import { useFormContext, useWatch } from "react-hook-form";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";

/**
 * Raw nginx config is admin-only: other users see a stored value read-only and, when it is empty, a hint that the
 * config is for administrators. A window with two of these fields passes emptyHint={false} to both and shows the hint
 * once itself when both are empty.
 *
 * @param {Object}  props
 * @param {string}  [props.name]       the form field
 * @param {string}  [props.label]      the translation id of the label
 * @param {string}  [props.id]         the textarea id
 * @param {boolean} [props.emptyHint]  show the admin-only hint in place of an empty field for a non-admin; when false
 *                                     the empty field renders nothing
 */
export function NginxConfigField({
	name = "advancedConfig",
	label = "nginx-config.label",
	id = "advancedConfig",
	emptyHint = true,
}) {
	const isAdmin = useIsAdmin();
	const { register } = useFormContext();
	const value = useWatch({ name });
	if (!isAdmin && !value?.trim()) {
		return emptyHint ? (
			<div className="text-secondary text-center my-3">
				<T id="nginx-config.admin-only" />
			</div>
		) : null;
	}
	return (
		<div className="mt-3">
			<label htmlFor={id} className="form-label">
				<T id={label} />
			</label>
			<textarea
				id={id}
				className="form-control font-monospace"
				spellCheck={false}
				placeholder={intl.formatMessage({ id: "nginx-config.placeholder" })}
				rows={9}
				readOnly={!isAdmin}
				aria-describedby={isAdmin ? undefined : `${id}-hint`}
				{...register(name)}
			/>
			{!isAdmin && (
				<div className="form-hint" id={`${id}-hint`}>
					<T id="nginx-config.admin-only" />
				</div>
			)}
		</div>
	);
}
