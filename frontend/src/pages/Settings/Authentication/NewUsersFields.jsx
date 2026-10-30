import { useFormContext, useFormState } from "react-hook-form";
import { NoticeAlert, SwitchField } from "src/components";
import { PermissionButtons, VisibilityButtons } from "src/components/Form/PermissionButtons";
import { intl, T } from "src/locale";

const PERMISSION_ROWS = [
	["proxyHosts", "proxy-hosts"],
	["redirectionHosts", "redirection-hosts"],
	["deadHosts", "dead-hosts"],
	["streams", "streams"],
	["accessLists", "access-lists"],
	["certificates", "certificates"],
];

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
			<div className="mb-3">
				<div className="form-label">
					<T id="permissions.visibility.title" />
				</div>
				<VisibilityButtons name="autoCreatePermissions.visibility" />
			</div>
			{PERMISSION_ROWS.map(([name, labelId]) => (
				<div className="mb-3" key={name}>
					<div className="form-label">
						<T id={labelId} />
					</div>
					<PermissionButtons name={`autoCreatePermissions.${name}`} />
				</div>
			))}
			<NoticeAlert variant="info" className="mb-0">
				<T id="settings.authentication.new-users.never-admin" />
			</NoticeAlert>
		</>
	);
}

export { DefaultPermissionsFields, NewUsersFields };
