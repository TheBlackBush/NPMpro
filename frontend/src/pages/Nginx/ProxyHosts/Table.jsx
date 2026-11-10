import { Zap } from "lucide-react";
import { useMemo } from "react";
import { AccessListFormatter } from "src/components/Table/Formatter/AccessListformatter";
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
import { forwardSummary } from "src/modules/Forward";
import { PROXY_HOSTS } from "src/modules/Permissions";

const ROW = { permission: PROXY_HOSTS, object: "proxy-host", rowName: (host) => host.domainNames[0] ?? `#${host.id}` };
const EMPTY = { icon: Zap, section: PROXY_HOSTS, object: "proxy-host", objects: "proxy-hosts" };

const accessSummary = (row) =>
	row.accessLists.length > 0
		? row.accessLists.map((list) => list.name).join(", ")
		: intl.formatMessage({
				id: row.npmproAccessListType === "custom" ? "access-list.custom" : "access-list.public",
			});

// shared with the list page, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns() {
	return useMemo(
		() => [
			ownerColumn(),
			domainsColumn(),
			columnHelper.accessor(forwardSummary, {
				id: "forwardHost",
				meta: { mobile: "summary", summaryText: (row) => forwardSummary(row) || null },
				header: intl.formatMessage({ id: "column.destination" }),
				cell: (info) => {
					if (info.row.original.forwardScheme === "path" || !info.getValue()) {
						return info.getValue();
					}
					return (
						<a href={info.getValue()} target="_blank" rel="noopener">
							{info.getValue()}
						</a>
					);
				},
			}),
			certificateColumn(),
			columnHelper.accessor(
				(row) => {
					const { accessLists } = row;
					const triggerLabel = intl.formatMessage({
						id: row.npmproAccessListType === "custom" ? "access-list.custom" : "access-list.public",
					});
					if (accessLists.length === 1) {
						return accessLists[0].name;
					}
					return triggerLabel;
				},
				{
					id: "accessList",
					meta: { mobile: "summary", summaryText: accessSummary },
					header: intl.formatMessage({ id: "column.access" }),
					cell: (info) => (
						<AccessListFormatter
							proxyHostId={info.row.original.id}
							locations={info.row.original.locations}
							access={info.row.original.accessLists}
							type={info.row.original.npmproAccessListType}
						/>
					),
				},
			),
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
