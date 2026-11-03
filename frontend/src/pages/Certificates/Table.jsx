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
import { Download, FlaskConical, KeyRound, Pencil, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo } from "react";
import {
	CertificateInUseFormatter,
	certificateProviderTranslation,
	DomainsFormatter,
	EmptyData,
	ExpiryFormatter,
	GravatarFormatter,
	RowActions,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { useCanManage } from "src/hooks";
import { intl, T } from "src/locale";
import { certificateActionKeys } from "src/modules/CertificateActions";
import { CERTIFICATES } from "src/modules/Permissions";
import { AddCertificateMenu } from "./AddCertificateMenu";

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

const isInUse = (row) =>
	[
		row.proxyHosts,
		row.redirectionHosts,
		row.deadHosts,
		row.streams,
		row.mtlsProxyHosts,
		row.mtlsRedirectionHosts,
		row.mtlsDeadHosts,
		row.mtlsStreams,
	].some((hosts) => hosts?.length > 0);

const columnHelper = createColumnHelper();

const providerSummary = (row) => {
	const name = intl.formatMessage({ id: certificateProviderTranslation(row.provider) });
	return row.provider === "letsencrypt" && row.npmproDnsChallenge ? `${name} \u2013 ${row.npmproDnsProvider}` : name;
};
const inUseSummary = (row) =>
	intl.formatMessage({ id: isInUse(row) ? "certificate.in-use" : "certificate.not-in-use" });

const actionDefs = {
	test: { label: "test", icon: FlaskConical, handler: "onTest", arg: (row) => row.domainNames },
	edit: { label: "action.edit", icon: Pencil, handler: "onEdit", arg: (row) => row },
	renew: { label: "action.renew", icon: RefreshCw, handler: "onRenew", arg: (row) => row.id },
	"change-dns": {
		label: "dns-credentials.change",
		icon: KeyRound,
		handler: "onChangeDnsCredential",
		arg: (row) => row,
	},
	download: { label: "action.download", icon: Download, handler: "onDownload", arg: (row) => row.id },
	delete: { label: "action.delete", icon: Trash2, handler: "onDelete", arg: (row) => row.id },
};

function CertificateActions({ certificate, ...handlers }) {
	const canManage = useCanManage(CERTIFICATES);
	const keys = certificateActionKeys({ ...certificate, inUse: isInUse(certificate) }, { canManage });
	return (
		<RowActions
			// names the row, so the buttons of a list are told apart (the nice name, else the first domain, as the Name column)
			label={intl.formatMessage(
				{ id: "list.row-actions" },
				{ name: certificate.niceName || certificate.domainNames[0] || `#${certificate.id}` },
			)}
			focusKey={`certificate-${certificate.id}`}
			title={<T id="object.actions-title" tData={{ object: "certificate" }} data={{ id: certificate.id }} />}
			items={keys.map((key) => {
				const def = actionDefs[key];
				return {
					key,
					label: <T id={def.label} />,
					icon: def.icon,
					onSelect: () => handlers[def.handler]?.(def.arg(certificate)),
					destructive: key === "delete",
					separatorBefore: key === "delete",
				};
			})}
		/>
	);
}

// Shared with the wrapper, which hands the sortable columns to the phone "Sort by" in ListToolbar.
// The columns keep their identity between renders and the row handlers reach the cells through the table meta
// (`meta.actions`); see the comment above useColumns in src/pages/Nginx/ProxyHosts/Table.jsx.
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
			columnHelper.accessor((row) => row.domainNames.join(", "), {
				id: "domainNames",
				meta: { mobile: "title" },
				header: intl.formatMessage({ id: "column.name" }),
				cell: (info) => {
					const value = info.row.original;
					return (
						<DomainsFormatter
							domains={value.domainNames}
							createdOn={value.createdOn}
							niceName={value.niceName}
							provider={value.provider}
						/>
					);
				},
			}),
			columnHelper.accessor(
				(row) => (row.npmproDnsProvider ? `${row.provider} - ${row.npmproDnsProvider}` : row.provider),
				{
					id: "provider",
					meta: { mobile: "summary", summaryText: providerSummary },
					header: intl.formatMessage({ id: "column.provider" }),
					cell: (info) => {
						const r = info.row.original;
						if (r.provider === "letsencrypt") {
							if (r.npmproDnsChallenge) {
								return (
									<>
										<T id="lets-encrypt" /> &ndash; {r.npmproDnsProvider}
									</>
								);
							}
							return <T id="lets-encrypt" />;
						}
						return <T id={certificateProviderTranslation(r.provider)} />;
					},
				},
			),
			columnHelper.accessor((row) => row.expiresOn, {
				id: "expiresOn",
				meta: { mobile: "title-below" },
				header: intl.formatMessage({ id: "column.expires" }),
				cell: (info) => <ExpiryFormatter value={info.getValue()} provider={info.row.original.provider} />,
			}),
			columnHelper.accessor(isInUse, {
				id: "inUse",
				meta: { mobile: "summary", summaryText: inUseSummary },
				header: intl.formatMessage({ id: "column.status" }),
				cell: (info) => {
					const r = info.row.original;
					return (
						<span className="text-nowrap">
							<CertificateInUseFormatter
								id={r.id}
								proxyHosts={[...r.proxyHosts, ...r.mtlsProxyHosts]}
								redirectionHosts={[...r.redirectionHosts, ...r.mtlsRedirectionHosts]}
								deadHosts={[...r.deadHosts, ...r.mtlsDeadHosts]}
								streams={[...r.streams, ...r.mtlsStreams]}
							/>
						</span>
					);
				},
			}),
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
				cell: (info) => (
					<CertificateActions certificate={info.row.original} {...info.table.options.meta?.actions} />
				),
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
	onDelete,
	onRenew,
	onDownload,
	onTest,
	onEdit,
	onChangeDnsCredential,
	isFiltered,
	onClearFilters,
	sorting,
	onSortingChange,
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
			actions: { onChangeDnsCredential, onDelete, onDownload, onEdit, onRenew, onTest },
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
					icon={ShieldCheck}
					object="certificate"
					objects="certificates"
					tableInstance={tableInstance}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					section="certificates"
					customAddBtn={<AddCertificateMenu />}
					permissionSection={CERTIFICATES}
				/>
			}
		/>
	);
}
