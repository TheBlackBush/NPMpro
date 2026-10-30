import { Field } from "formik";
import { useFormContext, useWatch } from "react-hook-form";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";

// in a React Hook Form form: the textarea registered under name
function HookFormNginxConfigField({ name, label, id }) {
	const isAdmin = useIsAdmin();
	const { register } = useFormContext();
	const value = useWatch({ name });
	return !isAdmin && !value?.trim() ? null : (
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

// in a Formik form (the proxy host window until Task 8)
function FormikNginxConfigField({ name, label, id }) {
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

/**
 * Raw nginx config is admin-only: other users see a stored value read-only and nothing when it is empty.
 */
export function NginxConfigField({ name = "advancedConfig", label = "nginx-config.label", id = "advancedConfig" }) {
	// Task 8 removes the Formik branch
	return useFormContext() ? (
		<HookFormNginxConfigField name={name} label={label} id={id} />
	) : (
		<FormikNginxConfigField name={name} label={label} id={id} />
	);
}
