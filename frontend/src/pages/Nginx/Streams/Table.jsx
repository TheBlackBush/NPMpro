import { IconDisc, IconDotsVertical, IconEdit, IconPower, IconTrash } from "@tabler/icons-react";
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
import { useMemo } from "react";
import {
	BreakableHost,
	CertificateFormatter,
	EmptyData,
	GravatarFormatter,
	HasPermission,
	StatusFormatter,
	ValueWithDateFormatter,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { MANAGE, STREAMS } from "src/modules/Permissions";

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

// shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar
export function useColumns({ onDelete, onDisableToggle, onEdit } = {}) {
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
					className: "text-nowrap",
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
					return value || <span className="text-secondary">—</span>;
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
						<>
							{value.tcpForwarding ? (
								<span className="badge badge-lg font-monospace">
									<T id="streams.tcp" />
								</span>
							) : null}
							{value.npmproProxyProtocolForwarding ? (
								<span className="badge badge-lg font-monospace">
									<T
										id={
											value.npmproProxyProtocolForwarding === 1
												? "streams.pp.v1"
												: "streams.pp.v2"
										}
									/>
								</span>
							) : null}
							{value.npmproProxyTls ? (
								<span className="badge badge-lg font-monospace">
									<T id="streams.tls" />
								</span>
							) : null}
							{value.udpForwarding ? (
								<span className="badge badge-lg font-monospace">
									<T id="streams.udp" />
								</span>
							) : null}
						</>
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
					className: "w-1 text-nowrap",
					mobile: "hide-lg",
				},
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => (
					<span className="dropdown">
						<button
							type="button"
							className="btn dropdown-toggle btn-action btn-sm px-1 d-inline-block"
							aria-label={intl.formatMessage({ id: "actions" })}
							data-bs-boundary="viewport"
							data-bs-toggle="dropdown"
							data-bs-popper-config='{"strategy":"fixed"}'
						>
							<IconDotsVertical />
						</button>
						<div className="dropdown-menu dropdown-menu-end">
							<span className="dropdown-header">
								<T
									id="object.actions-title"
									tData={{ object: "stream" }}
									data={{ id: info.row.original.id }}
								/>
							</span>
							<button
								type="button"
								className="dropdown-item"
								onClick={() => {
									onEdit?.(info.row.original.id);
								}}
							>
								<IconEdit className="icon dropdown-item-icon" aria-hidden="true" />
								<T id="action.edit" />
							</button>
							<HasPermission section={STREAMS} permission={MANAGE} hideError>
								<button
									type="button"
									className="dropdown-item"
									onClick={() => {
										onDisableToggle?.(info.row.original.id, !info.row.original.enabled);
									}}
								>
									<IconPower className="icon dropdown-item-icon" aria-hidden="true" />
									<T id={info.row.original.enabled ? "action.disable" : "action.enable"} />
								</button>
								<div className="dropdown-divider" />
								<button
									type="button"
									className="dropdown-item text-danger"
									onClick={() => {
										onDelete?.(info.row.original.id);
									}}
								>
									<IconTrash className="icon dropdown-item-icon" aria-hidden="true" />
									<T id="action.delete" />
								</button>
							</HasPermission>
						</div>
					</span>
				),
				meta: {
					className: "text-end text-nowrap",
					mobile: "title-end",
				},
			}),
		],
		[onDelete, onDisableToggle, onEdit],
	);
}

export default function Table({
	data,
	isFetching,
	isFiltered,
	onClearFilters,
	onEdit,
	onDelete,
	onDisableToggle,
	onNew,
	sorting,
	onSortingChange,
	showHeader,
	groupBy,
	renderGroupLabel,
}) {
	const columns = useColumns({ onDelete, onDisableToggle, onEdit });

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data,
		getRowId: (row) => `${row.id}`,
		meta: {
			isFetching,
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
					icon={IconDisc}
					object="stream"
					objects="streams"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					color="blue"
					permissionSection={STREAMS}
				/>
			}
		/>
	);
}
