import { HasPermission } from "src/components";
import { STREAMS, VIEW } from "src/modules/Permissions";
import { HostListPage } from "../HostListPage";
import { streamList } from "./listType";

const Streams = () => (
	<HasPermission section={STREAMS} permission={VIEW} pageLoading loadingNoLogo>
		<HostListPage list={streamList} />
	</HasPermission>
);

export default Streams;
