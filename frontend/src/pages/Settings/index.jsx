import { HasPermission, PageHeader } from "src/components";
import { T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";
import Layout from "./Layout";

const Settings = () => (
	<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
		<PageHeader title={<T id="settings" />} />
		<Layout />
	</HasPermission>
);

export default Settings;
