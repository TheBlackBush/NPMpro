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
import { TableLayout } from "src/components/Table/TableLayout";
import { Button } from "src/components/ui/button";
import { intl } from "src/locale";

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

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
						aria-label={intl.formatMessage({ id: "action.view-details" })}
						title={intl.formatMessage({ id: "action.view-details" })}
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
