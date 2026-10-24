import { Field, useFormikContext } from "formik";
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
	const { values, setFieldValue, errors } = useFormikContext();
	const domainsError = errors.autoCreateDomains;

	return (
		<>
			<SwitchField
				className="py-3"
				id="oidc-autoCreateEnabled"
				label={<T id="settings.authentication.auto-create" />}
				hint={<T id="settings.authentication.auto-create.hint" />}
				checked={Boolean(values.autoCreateEnabled)}
				onChange={(e) => setFieldValue("autoCreateEnabled", e.target.checked)}
			/>
			<div className="mb-3">
				<label className="form-label" htmlFor="oidc-autoCreateDomains">
					<T id="settings.authentication.allowed-domains" />
				</label>
				<Field name="autoCreateDomains">
					{({ field }) => (
						<input
							{...field}
							id="oidc-autoCreateDomains"
							type="text"
							className={`form-control${domainsError ? " is-invalid" : ""}`}
							autoComplete="off"
							placeholder={intl.formatMessage({
								id: "settings.authentication.allowed-domains.placeholder",
							})}
							aria-invalid={domainsError ? "true" : undefined}
							aria-describedby={
								domainsError ? "oidc-autoCreateDomains-error" : "oidc-autoCreateDomains-hint"
							}
						/>
					)}
				</Field>
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
				<Field name="autoCreatePermissions.visibility">
					{({ field, form }) => <VisibilityButtons field={field} form={form} />}
				</Field>
			</div>
			{PERMISSION_ROWS.map(([name, labelId]) => (
				<div className="mb-3" key={name}>
					<div className="form-label">
						<T id={labelId} />
					</div>
					<Field name={`autoCreatePermissions.${name}`}>
						{({ field, form }) => <PermissionButtons field={field} form={form} />}
					</Field>
				</div>
			))}
			<NoticeAlert variant="info" className="mb-0">
				<T id="settings.authentication.new-users.never-admin" />
			</NoticeAlert>
		</>
	);
}

export { DefaultPermissionsFields, NewUsersFields };
