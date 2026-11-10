import { deleteDeadHost, toggleDeadHost } from "src/api/backend";
import { getDirectory, useDeadHosts } from "src/hooks";
import { showDeadHostModal } from "src/modals";
import { HOST_TYPES } from "src/modules/HostTypes";
import Table, { useColumns } from "./Table";

export const deadHostList = {
	...HOST_TYPES.dead,
	type: "dead",
	useList: useDeadHosts,
	useColumns,
	Table,
	toggle: toggleDeadHost,
	remove: deleteDeadHost,
	showModal: showDeadHostModal,
	searchText: (item) => `${item.domainNames.join(" ")} ${getDirectory(item) ?? ""}`,
	deleteSubject: (host) => host?.domainNames.join(", "),
};
