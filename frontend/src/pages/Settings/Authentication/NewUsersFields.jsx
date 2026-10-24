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
	const { values, setFieldValue } = useFormikContext();

	return (
		<div className="mb-4">
			<h4 className="mb-3">
				<T id="settings.authentication.new-users" />
			</h4>
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
							className="form-control"
							autoComplete="off"
							placeholder={intl.formatMessage({
								id: "settings.authentication.allowed-domains.placeholder",
							})}
							aria-describedby="oidc-autoCreateDomains-hint"
						/>
					)}
				</Field>
				<small id="oidc-autoCreateDomains-hint" className="form-hint">
					<T id="settings.authentication.allowed-domains.hint" />
				</small>
			</div>
			<h5 className="mb-3">
				<T id="settings.authentication.default-permissions" />
			</h5>
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
		</div>
	);
}

export { NewUsersFields };
