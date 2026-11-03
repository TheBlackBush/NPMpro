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
import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { useMemo } from "react";
import { EmptyData, GravatarFormatter, RowActions, ValueWithDateFormatter } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { Badge } from "src/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { useCanManage, useDnsProviders } from "src/hooks";
import { intl, T } from "src/locale";
import { CERTIFICATES } from "src/modules/Permissions";

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

function UsedBy({ certificates }) {
	if (certificates.length === 0) {
		return <span className="text-muted-foreground">0</span>;
	}
	return (
		<Popover>
			<PopoverTrigger asChild>
				<button type="button" className="rounded-sm text-start underline-offset-4 hover:underline">
					{certificates.length}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto max-w-80">
				{certificates.map((cert) => (
					<div key={cert.id}>{cert.niceName}</div>
				))}
			</PopoverContent>
		</Popover>
	);
}

function DnsCredentialActions({ credential, onDelete, onEdit }) {
	const canManage = useCanManage(CERTIFICATES);
	const inUse = (credential.certificates?.length ?? 0) > 0;
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart
			label={intl.formatMessage({ id: "list.row-actions" }, { name: credential.name || `#${credential.id}` })}
			focusKey={`dns-credential-${credential.id}`}
			title={<T id="object.actions-title" tData={{ object: "dns-credential" }} data={{ id: credential.id }} />}
			items={[
				{
					key: "edit",
					label: <T id="action.edit" />,
					icon: Pencil,
					onSelect: () => onEdit?.(credential.id),
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					onSelect: () => onDelete?.(credential.id),
					destructive: !inUse,
					separatorBefore: true,
					// a credential used by a certificate cannot be deleted
					disabled: inUse,
					title: inUse ? intl.formatMessage({ id: "dns-credentials.in-use" }) : undefined,
					hidden: !canManage,
				},
			]}
		/>
	);
}

const columnHelper = createColumnHelper();

// Shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar.
// The columns keep their identity between renders and the row handlers reach the cells through the table meta
// (`meta.actions`); see the comment above useColumns in src/pages/Nginx/ProxyHosts/Table.jsx.
export function useColumns() {
	const { data: providers } = useDnsProviders();
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
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "dns-credentials.name" }),
				cell: (info) => (
					<>
						<ValueWithDateFormatter
							value={info.row.original.name}
							createdOn={info.row.original.createdOn}
						/>
						{info.row.original.decryptError ? (
							<Badge variant="outline" className="ms-1 border-warning text-warning">
								<T id="dns-credentials.decrypt-error-short" />
							</Badge>
						) : null}
					</>
				),
			}),
			columnHelper.accessor((row) => row.provider, {
				id: "provider",
				meta: {
					mobile: "summary",
					summaryText: (row) => providers?.find((p) => p.id === row.provider)?.name ?? row.provider,
				},
				header: intl.formatMessage({ id: "certificates.dns.provider" }),
				cell: (info) => providers?.find((p) => p.id === info.getValue())?.name ?? info.getValue(),
			}),
			columnHelper.accessor((row) => row.certificates?.length ?? 0, {
				id: "usedBy",
				meta: {
					mobile: "summary",
					summaryText: (row) =>
						intl.formatMessage(
							{ id: "dns-credentials.used-by-count" },
							{ count: row.certificates?.length ?? 0 },
						),
				},
				header: intl.formatMessage({ id: "dns-credentials.used-by" }),
				cell: (info) => <UsedBy certificates={info.row.original.certificates ?? []} />,
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => (
					<DnsCredentialActions credential={info.row.original} {...info.table.options.meta?.actions} />
				),
				meta: {
					className: "text-right whitespace-nowrap",
					mobile: "title-end",
				},
			}),
		],
		[providers],
	);
}

export default function Table({ data, isFetching, isFiltered, onEdit, onDelete, onNew, sorting, onSortingChange }) {
	const columns = useColumns();

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data,
		getRowId: (row) => `${row.id}`,
		// the row handlers live here, not in the columns (see useColumns)
		meta: {
			isFetching,
			actions: { onDelete, onEdit },
		},
		enableSortingRemoval: false,
		state: { sorting },
		onSortingChange,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					icon={KeyRound}
					object="dns-credential"
					objects="dns-credentials"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					section="dnsCredentials"
					permissionSection={CERTIFICATES}
				/>
			}
		/>
	);
}
