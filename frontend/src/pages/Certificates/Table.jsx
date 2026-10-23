import {
	IconCloud,
	IconDotsVertical,
	IconDownload,
	IconEdit,
	IconFlask,
	IconKey,
	IconRefresh,
	IconShield,
	IconShieldLock,
	IconTrash,
	IconUpload,
	IconWorld,
} from "@tabler/icons-react";
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
	CertificateInUseFormatter,
	certificateProviderTranslation,
	DomainsFormatter,
	EmptyData,
	ExpiryFormatter,
	GravatarFormatter,
	HasPermission,
} from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { showCustomCertificateModal, showDNSCertificateModal, showHTTPCertificateModal } from "src/modals";
import { CERTIFICATES, MANAGE } from "src/modules/Permissions";

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
}) {
	const columnHelper = createColumnHelper();
	const columns = useMemo(
		() => [
			columnHelper.accessor((row) => row.owner?.name, {
				id: "owner",
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
				},
			}),
			columnHelper.accessor((row) => row.domainNames.join(", "), {
				id: "domainNames",
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
				header: intl.formatMessage({ id: "column.expires" }),
				cell: (info) => <ExpiryFormatter value={info.getValue()} provider={info.row.original.provider} />,
			}),
			columnHelper.accessor(isInUse, {
				id: "inUse",
				header: intl.formatMessage({ id: "column.status" }),
				cell: (info) => {
					const r = info.row.original;
					return (
						<CertificateInUseFormatter
							proxyHosts={[...r.proxyHosts, ...r.mtlsProxyHosts]}
							redirectionHosts={[...r.redirectionHosts, ...r.mtlsRedirectionHosts]}
							deadHosts={[...r.deadHosts, ...r.mtlsDeadHosts]}
							streams={[...r.streams, ...r.mtlsStreams]}
						/>
					);
				},
			}),
			columnHelper.accessor((row) => row.id, {
				id: "id",
				header: "ID",
				cell: (info) => info.getValue(),
				meta: {
					className: "text-end text-nowrap",
				},
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => {
					const row = info.row.original;
					const inUse = isInUse(row);

					return (
						<span className="dropdown">
							<button
								type="button"
								className="btn dropdown-toggle btn-action btn-sm px-1"
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
										tData={{ object: "certificate" }}
										data={{ id: row.id }}
									/>
								</span>

								{row.provider === "letsencrypt" && !row.npmproDnsProvider && (
									<button
										type="button"
										className="dropdown-item"
										onClick={() => {
											onTest?.(row.domainNames);
										}}
									>
										<IconFlask className="icon dropdown-item-icon" aria-hidden="true" />
										<T id="test" />
									</button>
								)}

								<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
									{(row.provider === "other" || row.provider === "mtls") && (
										<button
											type="button"
											className="dropdown-item"
											onClick={() => {
												onEdit?.(row);
											}}
										>
											<IconEdit className="icon dropdown-item-icon" aria-hidden="true" />
											<T id="action.edit" />
										</button>
									)}

									{row.provider === "letsencrypt" && (
										<button
											type="button"
											className="dropdown-item"
											onClick={() => {
												onRenew?.(row.id);
											}}
										>
											<IconRefresh className="icon dropdown-item-icon" aria-hidden="true" />
											<T id="action.renew" />
										</button>
									)}

									{row.provider === "letsencrypt" && row.npmproDnsChallenge && (
										<button
											type="button"
											className="dropdown-item"
											onClick={() => {
												onChangeDnsCredential?.(row);
											}}
										>
											<IconKey className="icon dropdown-item-icon" aria-hidden="true" />
											<T id="dns-credentials.change" />
										</button>
									)}

									<button
										type="button"
										className="dropdown-item"
										onClick={() => {
											onDownload?.(row.id);
										}}
									>
										<IconDownload className="icon dropdown-item-icon" aria-hidden="true" />
										<T id="action.download" />
									</button>

									{!inUse && (
										<>
											<div className="dropdown-divider" />
											<button
												type="button"
												className="dropdown-item text-danger"
												onClick={() => {
													onDelete?.(row.id);
												}}
											>
												<IconTrash className="icon dropdown-item-icon" aria-hidden="true" />
												<T id="action.delete" />
											</button>
										</>
									)}
								</HasPermission>
							</div>
						</span>
					);
				},
				meta: {
					className: "text-end text-nowrap",
				},
			}),
		],
		[columnHelper, onDelete, onRenew, onDownload, onTest, onEdit, onChangeDnsCredential],
	);

	const tableInstance = useTable({
		features,
		columns: columnHelper.columns(columns),
		data,
		getRowId: (row) => `${row.id}`,
		meta: {
			isFetching,
		},
		enableSortingRemoval: false,
		initialState: { sorting: [{ id: "expiresOn", desc: false }] },
	});

	const customAddBtn = (
		<div className="dropdown">
			<button
				type="button"
				className="btn dropdown-toggle btn-pink my-3"
				data-bs-toggle="dropdown"
				data-bs-popper-config='{"strategy":"fixed"}'
			>
				<T id="object.add" tData={{ object: "certificate" }} />
			</button>
			<div className="dropdown-menu">
				<button
					type="button"
					className="dropdown-item"
					onClick={() => {
						showHTTPCertificateModal();
					}}
				>
					<IconWorld className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="lets-encrypt-via-http" />
				</button>
				<button
					type="button"
					className="dropdown-item"
					onClick={() => {
						showDNSCertificateModal();
					}}
				>
					<IconCloud className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="lets-encrypt-via-dns" />
				</button>
				<div className="dropdown-divider" />
				<button
					type="button"
					className="dropdown-item"
					onClick={() => {
						showCustomCertificateModal();
					}}
				>
					<IconUpload className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="certificates.custom" />
				</button>
				<div className="dropdown-divider" />
				<button
					type="button"
					className="dropdown-item"
					onClick={() => {
						showCustomCertificateModal(undefined, "mtls");
					}}
				>
					<IconShieldLock className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="certificates.mtls" />
				</button>
			</div>
		</div>
	);

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					icon={IconShield}
					object="certificate"
					objects="certificates"
					tableInstance={tableInstance}
					isFiltered={isFiltered}
					onClearFilters={onClearFilters}
					color="pink"
					customAddBtn={customAddBtn}
					permissionSection={CERTIFICATES}
				/>
			}
		/>
	);
}
