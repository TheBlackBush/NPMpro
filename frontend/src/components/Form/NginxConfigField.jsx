import { Field } from "formik";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";

/**
 * Raw nginx config is admin-only: other users see a stored value read-only and nothing when it is empty.
 */
export function NginxConfigField({ name = "advancedConfig", label = "nginx-config.label", id = "advancedConfig" }) {
	const isAdmin = useIsAdmin();
	return (
		<Field name={name}>
			{({ field }) =>
				!isAdmin && !field.value?.trim() ? null : (
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
							{...field}
						/>
						{!isAdmin && (
							<div className="form-hint" id={`${id}-hint`}>
								<T id="nginx-config.admin-only" />
							</div>
						)}
					</div>
				)
			}
		</Field>
	);
}
