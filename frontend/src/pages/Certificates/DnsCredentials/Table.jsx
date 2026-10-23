import { IconDotsVertical, IconEdit, IconKey, IconTrash } from "@tabler/icons-react";
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
import cn from "clsx";
import { useMemo } from "react";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Popover from "react-bootstrap/Popover";
import { EmptyData, GravatarFormatter, HasPermission, ValueWithDateFormatter } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { useDnsProviders } from "src/hooks";
import { intl, T } from "src/locale";
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

function UsedBy({ certificates }) {
	if (certificates.length === 0) {
		return <span className="text-secondary">0</span>;
	}
	const popover = (
		<Popover id="popover-dns-credential-used-by">
			<Popover.Body>
				{certificates.map((cert) => (
					<div key={cert.id}>{cert.niceName}</div>
				))}
			</Popover.Body>
		</Popover>
	);
	return (
		<OverlayTrigger trigger={["hover", "click", "focus"]} placement="bottom" overlay={popover}>
			<div>{certificates.length}</div>
		</OverlayTrigger>
	);
}

export default function Table({ data, isFetching, isFiltered, onEdit, onDelete, onNew }) {
	const columnHelper = createColumnHelper();
	const { data: providers } = useDnsProviders();
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
			columnHelper.accessor((row) => row.name, {
				id: "name",
				header: intl.formatMessage({ id: "dns-credentials.name" }),
				cell: (info) => (
					<>
						<ValueWithDateFormatter
							value={info.row.original.name}
							createdOn={info.row.original.createdOn}
						/>
						{info.row.original.decryptError ? (
							<span className="badge bg-warning-lt ms-1">
								<T id="dns-credentials.decrypt-error-short" />
							</span>
						) : null}
					</>
				),
			}),
			columnHelper.accessor((row) => row.provider, {
				id: "provider",
				header: intl.formatMessage({ id: "certificates.dns.provider" }),
				cell: (info) => providers?.find((p) => p.id === info.getValue())?.name ?? info.getValue(),
			}),
			columnHelper.accessor((row) => row.certificates?.length ?? 0, {
				id: "usedBy",
				header: intl.formatMessage({ id: "dns-credentials.used-by" }),
				cell: (info) => <UsedBy certificates={info.row.original.certificates ?? []} />,
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => {
					const inUse = (info.row.original.certificates?.length ?? 0) > 0;
					return (
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
										tData={{ object: "dns-credential" }}
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
								<HasPermission section={CERTIFICATES} permission={MANAGE} hideError>
									<div className="dropdown-divider" />
									<button
										type="button"
										className={cn("dropdown-item", !inUse && "text-danger")}
										disabled={inUse}
										title={inUse ? intl.formatMessage({ id: "dns-credentials.in-use" }) : undefined}
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
					);
				},
				meta: {
					className: "text-end text-nowrap",
				},
			}),
		],
		[columnHelper, onEdit, onDelete, providers],
	);

	const tableInstance = useTable({
		features,
		columns,
		data,
		getRowId: (row) => `${row.id}`,
		meta: {
			isFetching,
		},
		enableSortingRemoval: false,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					icon={IconKey}
					object="dns-credential"
					objects="dns-credentials"
					tableInstance={tableInstance}
					onNew={onNew}
					isFiltered={isFiltered}
					color="pink"
					permissionSection={CERTIFICATES}
				/>
			}
		/>
	);
}
