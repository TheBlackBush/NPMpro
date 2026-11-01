import { useFormContext } from "react-hook-form";
import { NoticeAlert, SwitchField, SwitchList, TextField } from "src/components";
import { PERMISSION_ROWS, PermissionButtons, VisibilityButtons } from "src/components/Form/PermissionButtons";
import { intl, T } from "src/locale";

function NewUsersFields() {
	const { register } = useFormContext();

	return (
		<>
			<SwitchList className="mb-3">
				<SwitchField
					{...register("autoCreateEnabled")}
					id="oidc-autoCreateEnabled"
					label={<T id="settings.authentication.auto-create" />}
					hint={<T id="settings.authentication.auto-create.hint" />}
				/>
			</SwitchList>
			<TextField
				name="autoCreateDomains"
				id="oidc-autoCreateDomains"
				label={<T id="settings.authentication.allowed-domains" />}
				hint={<T id="settings.authentication.allowed-domains.hint" />}
				type="text"
				autoComplete="off"
				placeholder={intl.formatMessage({ id: "settings.authentication.allowed-domains.placeholder" })}
			/>
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
