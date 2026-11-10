import { HasPermission } from "src/components";
import { PROXY_HOSTS, VIEW } from "src/modules/Permissions";
import { HostListPage } from "../HostListPage";
import { proxyHostList } from "./listType";

const ProxyHosts = () => (
	<HasPermission section={PROXY_HOSTS} permission={VIEW} pageLoading loadingNoLogo>
		<HostListPage list={proxyHostList} />
	</HasPermission>
);

export default ProxyHosts;
