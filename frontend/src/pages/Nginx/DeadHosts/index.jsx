import { HasPermission } from "src/components";
import { DEAD_HOSTS, VIEW } from "src/modules/Permissions";
import { HostListPage } from "../HostListPage";
import { deadHostList } from "./listType";

const DeadHosts = () => (
	<HasPermission section={DEAD_HOSTS} permission={VIEW} pageLoading loadingNoLogo>
		<HostListPage list={deadHostList} />
	</HasPermission>
);

export default DeadHosts;
