import { deleteRedirectionHost, toggleRedirectionHost } from "src/api/backend";
import { getDirectory, useRedirectionHosts } from "src/hooks";
import { showRedirectionHostModal } from "src/modals";
import { HOST_TYPES } from "src/modules/HostTypes";
import Table, { useColumns } from "./Table";

export const redirectionHostList = {
	...HOST_TYPES.redirection,
	type: "redirection",
	pagingKey: "redirection-hosts",
	useList: useRedirectionHosts,
	useColumns,
	Table,
	toggle: toggleRedirectionHost,
	remove: deleteRedirectionHost,
	showModal: showRedirectionHostModal,
	searchText: (item) => `${item.domainNames.join(" ")} ${item.forwardDomainName} ${getDirectory(item) ?? ""}`,
	deleteSubject: (host) => host?.domainNames.join(", "),
	deleteDetails: (host) =>
		host &&
		(host.forwardScheme === "$scheme"
			? host.forwardDomainName
			: `${host.forwardScheme}://${host.forwardDomainName}`),
};
