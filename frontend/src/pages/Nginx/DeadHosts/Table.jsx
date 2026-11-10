import { Unplug } from "lucide-react";
import { useMemo } from "react";
import { HostTable } from "src/components/Table/HostTable";
import {
	actionsColumn,
	certificateColumn,
	domainsColumn,
	idColumn,
	ownerColumn,
	statusColumn,
} from "src/components/Table/hostColumns";
import { DEAD_HOSTS } from "src/modules/Permissions";

const ROW = { permission: DEAD_HOSTS, object: "dead-host", rowName: (host) => host.domainNames[0] ?? `#${host.id}` };
const EMPTY = { icon: Unplug, section: DEAD_HOSTS, object: "dead-host", objects: "dead-hosts" };

// shared with the list page, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns() {
	return useMemo(
		() => [ownerColumn(), domainsColumn(), certificateColumn(), statusColumn(), idColumn(), actionsColumn(ROW)],
		[],
	);
}

export default function Table(props) {
	return <HostTable {...props} columns={useColumns()} empty={EMPTY} />;
}
