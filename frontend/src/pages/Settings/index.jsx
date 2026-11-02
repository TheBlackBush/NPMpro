import { HasPermission, PageHeader } from "src/components";
import { T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";
import Layout from "./Layout";

// the title shows for every user, also above the no-permission message
const Settings = () => (
	<>
		<PageHeader title={<T id="settings" />} />
		<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
			<Layout />
		</HasPermission>
	</>
);

export default Settings;
