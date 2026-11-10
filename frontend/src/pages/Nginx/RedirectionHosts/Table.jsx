import { ArrowLeftRight } from "lucide-react";
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
import { appColumnHelper as columnHelper } from "src/components/Table/useAppTable";
import { intl } from "src/locale";
import { REDIRECTION_HOSTS } from "src/modules/Permissions";

const ROW = {
	permission: REDIRECTION_HOSTS,
	object: "redirection-host",
	rowName: (host) => host.domainNames[0] ?? `#${host.id}`,
};
const EMPTY = {
	icon: ArrowLeftRight,
	section: REDIRECTION_HOSTS,
	object: "redirection-host",
	objects: "redirection-hosts",
};

const redirectSummary = (row) => {
	const target =
		row.forwardScheme === "$scheme" ? row.forwardDomainName : `${row.forwardScheme}://${row.forwardDomainName}`;
	return [target, row.forwardHttpCode].filter(Boolean).join(" · ");
};
// shared with the list page, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns() {
	return useMemo(
		() => [
			ownerColumn(),
			domainsColumn(),
			columnHelper.accessor((row) => row.forwardHttpCode, {
				id: "forwardHttpCode",
				// the code and the scheme show inside the target's summary text ("https://target · 301")
				meta: { mobile: "summary", summaryText: () => null },
				header: intl.formatMessage({ id: "column.http-code" }),
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor((row) => row.forwardScheme, {
				id: "forwardScheme",
				meta: { mobile: "summary", summaryText: () => null },
				header: intl.formatMessage({ id: "column.scheme" }),
				cell: (info) =>
					info.getValue() === "$scheme"
						? intl.formatMessage({ id: "redirection.scheme.keep" })
						: info.getValue(),
			}),
			columnHelper.accessor((row) => row.forwardDomainName, {
				id: "forwardDomainName",
				meta: { mobile: "summary", summaryText: redirectSummary },
				header: intl.formatMessage({ id: "column.destination" }),
				cell: (info) => info.getValue(),
			}),
			certificateColumn(),
			statusColumn(),
			idColumn(),
			actionsColumn(ROW),
		],
		[],
	);
}

export default function Table(props) {
	return <HostTable {...props} columns={useColumns()} empty={EMPTY} />;
}
