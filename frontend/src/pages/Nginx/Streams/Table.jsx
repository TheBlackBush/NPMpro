import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { Copy, Disc3, Eye, Pencil, Power, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
	BreakableHost,
	CertificateFormatter,
	EmptyData,
	GravatarFormatter,
	RowActions,
	StatusFormatter,
	ValueWithDateFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { Badge } from "src/components/ui/badge";
import { useCanManage } from "src/hooks";
import { intl, T } from "src/locale";
import { STREAMS } from "src/modules/Permissions";

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

const columnHelper = createColumnHelper();

const streamDestination = (row) => `${row.forwardingHost}${row.forwardingPort ? `:${row.forwardingPort}` : ""}`;
const streamProtocols = (row) => {
	const protocols = [];
	if (row.tcpForwarding) protocols.push("TCP");
	if (row.npmproProxyProtocolForwarding) {
		protocols.push(row.npmproProxyProtocolForwarding === 1 ? "PPv1" : "PPv2");
	}
	if (row.npmproProxyTls) protocols.push("TLS");
	if (row.udpForwarding) protocols.push("UDP");
	return protocols;
};
// upstream TLS gets its own words, so it does not read like the certificate's "TLS" / "No TLS" next to it
const protocolSummary = (row) => {
	const transport = streamProtocols(row).filter((protocol) => protocol !== "TLS");
	const parts = [transport.join("/"), row.npmproProxyTls ? intl.formatMessage({ id: "streams.tls" }) : ""];
	return parts.filter(Boolean).join(" · ") || null;
};
const tlsSummary = (row) => intl.formatMessage({ id: row.certificate ? "column.ssl" : "no-tls" });

function StreamActions({ stream, onClone, onDelete, onDisableToggle, onEdit }) {
	const canManage = useCanManage(STREAMS);
	return (
		<RowActions
			// names the row by what it shows first: its incoming port
			label={intl.formatMessage(
				{ id: "list.row-actions" },
				{ name: String(stream.incomingPort ?? `#${stream.id}`) },
			)}
			focusKey={`stream-${stream.id}`}
			title={<T id="object.actions-title" tData={{ object: "stream" }} data={{ id: stream.id }} />}
			items={[
				{
					key: "edit",
					// a user who may only view gets the View window
					label: <T id={canManage ? "action.edit" : "action.view"} />,
					icon: canManage ? Pencil : Eye,
					onSelect: () => onEdit?.(stream.id),
				},
				{
					key: "clone",
					label: <T id="action.clone" />,
					icon: Copy,
					onSelect: () => onClone?.(stream.id),
					hidden: !canManage,
				},
				{
					key: "toggle",
					label: <T id={stream.enabled ? "action.disable" : "action.enable"} />,
					icon: Power,
					onSelect: () => onDisableToggle?.(stream.id, !stream.enabled),
					hidden: !canManage,
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDelete?.(stream.id),
					destructive: true,
					separatorBefore: true,
					hidden: !canManage,
				},
			]}
		/>
	);
}

// Shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar.
// Stable columns, row handlers through the table meta: see ProxyHosts/Table.jsx.
export function useColumns() {
	return useMemo(
		() => [
			columnHelper.accessor((row) => row.owner?.name, {
				id: "owner",
				enableSorting: false,
				cell: (info) => {
					const value = info.row.original.owner;
					return (
						<GravatarFormatter
							url={value ? value.avatar : ""}
							name={value ? value.name : intl.formatMessage({ id: "user.deleted" })}
						/>
					);
				},
				meta: {
					className: "whitespace-nowrap",
					mobile: "hide-lg",
				},
			}),
			columnHelper.accessor((row) => row.incomingPort, {
				id: "incomingPort",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "column.incoming-port" }),
				cell: (info) => {
					const value = info.row.original;
					return <ValueWithDateFormatter value={value.incomingPort} createdOn={value.createdOn} />;
				},
			}),
			columnHelper.accessor((row) => row.npmproDescription, {
				id: "npmproDescription",
				meta: { mobile: "summary", summaryText: (row) => row.npmproDescription || null },
				header: intl.formatMessage({ id: "column.description" }),
				cell: (info) => {
					const value = info.row.original.npmproDescription;
					return value || null;
				},
			}),
			columnHelper.accessor(streamDestination, {
				id: "destination",
				meta: { mobile: "summary", summaryText: streamDestination },
				header: intl.formatMessage({ id: "column.destination" }),
				cell: (info) => <BreakableHost value={info.getValue()} />,
			}),
			columnHelper.accessor((row) => streamProtocols(row).join(" "), {
				id: "protocol",
				meta: { mobile: "summary", summaryText: protocolSummary },
				header: intl.formatMessage({ id: "column.protocol" }),
				cell: (info) => {
					const value = info.row.original;
					return (
						<div className="flex flex-wrap gap-1">
							{value.tcpForwarding ? (
								<Badge variant="outline" className="font-mono">
									<T id="streams.tcp" />
								</Badge>
							) : null}
							{value.npmproProxyProtocolForwarding ? (
								<Badge variant="outline" className="font-mono">
									<T
										id={
											value.npmproProxyProtocolForwarding === 1
												? "streams.pp.v1"
												: "streams.pp.v2"
										}
									/>
								</Badge>
							) : null}
							{value.npmproProxyTls ? (
								<Badge variant="outline" className="font-mono">
									<T id="streams.tls" />
								</Badge>
							) : null}
							{value.udpForwarding ? (
								<Badge variant="outline" className="font-mono">
									<T id="streams.udp" />
								</Badge>
							) : null}
						</div>
					);
				},
			}),
			columnHelper.accessor((row) => (row.certificate ? row.certificate.provider : "http-only"), {
				id: "certificate",
				meta: { mobile: "summary", summaryText: tlsSummary },
				header: intl.formatMessage({ id: "column.ssl" }),
				cell: (info) => <CertificateFormatter certificate={info.row.original.certificate} />,
			}),
			columnHelper.accessor(
				(row) => {
					if (!row.enabled) return "3disabled";
					if (row.npmproNginxOnline) return "2online";
					return "1offline";
				},
				{
					id: "enabled",
					meta: { mobile: "title-below" },
					header: intl.formatMessage({ id: "column.status" }),
					cell: (info) => {
						const value = info.row.original;
						return (
							<StatusFormatter
								enabled={value.enabled}
								nginxOnline={value.npmproNginxOnline}
								nginxErr={value.npmproNginxErr}
							/>
						);
					},
				},
			),
			columnHelper.accessor((row) => row.id, {
				id: "id",
				header: "ID",
				cell: (info) => info.getValue(),
				meta: {
					className: "w-px whitespace-nowrap",
					mobile: "hide-lg",
				},
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => <StreamActions stream={info.row.original} {...info.table.options.meta?.actions} />,
				meta: {
					className: "text-right whitespace-nowrap",
					mobile: "title-end",
				},
			}),
		],
		[],
	);
}

export default function Table({
	data,
	isFetching,
	isFiltered,
	onClearFilters,
	onEdit,
	onClone,
	onDelete,
	onDisableToggle,
	onNew,
	sorting,
	onSortingChange,
	showHeader,
	groupBy,
	renderGroupLabel,
}) {
	const columns = useColumns();

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data,
		getRowId: (row) => `${row.id}`,
		// the row handlers live here, not in the columns (see useColumns)
		meta: {
			isFetching,
			actions: { onClone, onDelete, onDisableToggle, onEdit },
		},
		enableSortingRemoval: false,
		state: { sorting },
		onSortingChange,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			showHeader={showHeader}
			groupBy={groupBy}
			renderGroupLabel={renderGroupLabel}
			emptyState={
				<EmptyData
					icon={Disc3}
					section="streams"
					object="stream"
					objects="streams"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					permissionSection={STREAMS}
				/>
			}
		/>
	);
}
