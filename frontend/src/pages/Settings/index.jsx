import { HasPermission } from "src/components";
import { T } from "src/locale";
import { ADMIN, VIEW } from "src/modules/Permissions";
import Layout from "./Layout";

const Settings = () => (
	<HasPermission section={ADMIN} permission={VIEW} pageLoading loadingNoLogo>
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-semibold tracking-tight">
				<T id="settings" />
			</h1>
			<Layout />
		</div>
	</HasPermission>
);

export default Settings;
