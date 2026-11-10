import { HasPermission } from "src/components";
import { REDIRECTION_HOSTS, VIEW } from "src/modules/Permissions";
import { HostListPage } from "../HostListPage";
import { redirectionHostList } from "./listType";

const RedirectionHosts = () => (
	<HasPermission section={REDIRECTION_HOSTS} permission={VIEW} pageLoading loadingNoLogo>
		<HostListPage list={redirectionHostList} />
	</HasPermission>
);

export default RedirectionHosts;
