import { useFormContext, useFormState } from "react-hook-form";
import { NoticeAlert, SwitchField } from "src/components";
import { PERMISSION_ROWS, PermissionButtons, VisibilityButtons } from "src/components/Form/PermissionButtons";
import { intl, T } from "src/locale";

function NewUsersFields() {
	const { register } = useFormContext();
	const { errors } = useFormState({ name: "autoCreateDomains", exact: true });
	const domainsError = errors.autoCreateDomains?.message;

	return (
		<>
			<SwitchField
				{...register("autoCreateEnabled")}
				className="py-3"
				id="oidc-autoCreateEnabled"
				label={<T id="settings.authentication.auto-create" />}
				hint={<T id="settings.authentication.auto-create.hint" />}
			/>
			<div className="mb-3">
				<label className="form-label" htmlFor="oidc-autoCreateDomains">
					<T id="settings.authentication.allowed-domains" />
				</label>
				<input
					{...register("autoCreateDomains")}
					id="oidc-autoCreateDomains"
					type="text"
					className={`form-control${domainsError ? " is-invalid" : ""}`}
					autoComplete="off"
					placeholder={intl.formatMessage({
						id: "settings.authentication.allowed-domains.placeholder",
					})}
					aria-invalid={domainsError ? "true" : undefined}
					aria-describedby={domainsError ? "oidc-autoCreateDomains-error" : "oidc-autoCreateDomains-hint"}
				/>
				{domainsError ? (
					<div className="invalid-feedback" id="oidc-autoCreateDomains-error">
						{domainsError}
					</div>
				) : null}
				<small id="oidc-autoCreateDomains-hint" className="form-hint">
					<T id="settings.authentication.allowed-domains.hint" />
				</small>
			</div>
		</>
	);
}

function DefaultPermissionsFields() {
	return (
		<>
			<VisibilityButtons name="autoCreatePermissions.visibility" />
			{PERMISSION_ROWS.map(([name, labelId]) => (
				<PermissionButtons key={name} name={`autoCreatePermissions.${name}`} legend={<T id={labelId} />} />
			))}
			<NoticeAlert variant="info" className="mb-0">
				<T id="settings.authentication.new-users.never-admin" />
			</NoticeAlert>
		</>
	);
}

export { DefaultPermissionsFields, NewUsersFields };
