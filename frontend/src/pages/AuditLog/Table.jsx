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
import { Eye } from "lucide-react";
import { useMemo } from "react";
import { EventFormatter, GravatarFormatter } from "src/components";
import { Button } from "src/components/Button";
import { TableLayout } from "src/components/Table/TableLayout";
import { formatDateTime, intl } from "src/locale";

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

// what a row shows first: the object (its type and name or domains), the user and the date, so each button has its own name
function eventName(row) {
	const type = intl.formatMessage({ id: row.objectType, defaultMessage: row.objectType });
	const value = row.meta?.domainNames?.join(", ") || row.meta?.name || row.meta?.id || "";
	return [`${type} ${value}`.trim(), row.user?.name, formatDateTime(row.createdOn)].filter(Boolean).join(", ");
}

export default function Table({ data, isFetching, onSelectItem }) {
	const columnHelper = createColumnHelper();
	const columns = useMemo(
		() => [
			columnHelper.accessor((row) => row.user?.name, {
				id: "avatar",
				enableSorting: false,
				cell: (info) => {
					const value = info.row.original.user;
					return (
						<GravatarFormatter
							url={value ? value.avatar : ""}
							name={value ? value.name : intl.formatMessage({ id: "user.deleted" })}
						/>
					);
				},
				meta: {
					className: "whitespace-nowrap",
				},
			}),
			columnHelper.accessor((row) => row.createdOn, {
				id: "log",
				header: intl.formatMessage({ id: "column.event" }),
				cell: (info) => <EventFormatter row={info.row.original} />,
				// long domain lists wrap instead of widening the scroll area
				meta: {
					className: "whitespace-normal",
				},
			}),
			columnHelper.display({
				id: "details",
				cell: (info) => (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={intl.formatMessage(
							{ id: "auditlog.details-for" },
							{ name: eventName(info.row.original) },
						)}
						title={intl.formatMessage({ id: "tooltip.event-details" })}
						onClick={(e) => {
							e.preventDefault();
							onSelectItem?.(info.row.original.id);
						}}
					>
						<Eye aria-hidden="true" />
					</Button>
				),
				meta: {
					className: "text-right whitespace-nowrap",
				},
			}),
		],
		[columnHelper, onSelectItem],
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
	});

	return (
		<TableLayout tableInstance={tableInstance} layout="scroll" label={intl.formatMessage({ id: "auditlogs" })} />
	);
}
