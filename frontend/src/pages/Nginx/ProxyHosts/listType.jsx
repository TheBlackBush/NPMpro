import { deleteProxyHost, toggleProxyHost } from "src/api/backend";
import { getDirectory, useProxyHosts } from "src/hooks";
import { T } from "src/locale";
import { showProxyHostModal } from "src/modals";
import { servesCurrentPage } from "src/modules/CurrentPage";
import { forwardSummary } from "src/modules/Forward";
import { HOST_TYPES } from "src/modules/HostTypes";
import Table, { useColumns } from "./Table";

// whether the host serves the page the browser is on: disabling or deleting it may lock the user out of NPMpro
const servesThisPage = (host) => servesCurrentPage(host?.domainNames, window.location.hostname);

export const proxyHostList = {
	...HOST_TYPES.proxy,
	type: "proxy",
	useList: useProxyHosts,
	useColumns,
	Table,
	toggle: toggleProxyHost,
	remove: deleteProxyHost,
	showModal: showProxyHostModal,
	searchText: (item) => `${item.domainNames.join(" ")} ${forwardSummary(item)} ${getDirectory(item) ?? ""}`,
	deleteSubject: (host) => host?.domainNames.join(", "),
	deleteDetails: (host) => host && forwardSummary(host),
	deleteWarning: (host) => (servesThisPage(host) ? <T id="proxy-host.serves-this-page" /> : null),
	disableQuestion: (host) =>
		servesThisPage(host)
			? {
					title: <T id="object.disable" tData={{ object: "proxy-host" }} />,
					children: <T id="object.disable.content" tData={{ object: "proxy-host" }} />,
					subject: host.domainNames.join(", "),
					details: forwardSummary(host),
					warning: <T id="proxy-host.serves-this-page" />,
					confirmLabel: <T id="action.disable" />,
				}
			: null,
};
