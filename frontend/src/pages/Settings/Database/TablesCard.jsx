import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { useMemo } from "react";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { totals } from "src/modules/DatabaseMove";

const label = (id) => intl.formatMessage({ id });

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

/**
 * The tables of the database in use with their row counts, sorted by name
 */
function TablesCard({ tables }) {
	const sum = totals(tables);
	const columns = useMemo(() => {
		const columnHelper = createColumnHelper();
		return [
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: label("settings.database.table"),
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor((row) => row.rows, {
				id: "rows",
				meta: { className: "text-end" },
				header: label("settings.database.rows"),
				cell: (info) => intl.formatNumber(info.getValue()),
			}),
		];
	}, []);

	const tableInstance = useTable({
		features,
		columns,
		data: tables,
		getRowId: (row) => row.name,
		enableSortingRemoval: false,
		initialState: { sorting: [{ id: "name", desc: false }] },
	});

	return (
		<div className="card mb-4">
			<div className="card-header">
				<div>
					<h3 className="card-title">
						<T id="settings.database.tables" />
					</h3>
					<div className="card-subtitle">
						<T
							id="settings.database.tables.total"
							data={{ tables: intl.formatNumber(sum.tables), rows: intl.formatNumber(sum.rows) }}
						/>
					</div>
				</div>
			</div>
			<TableLayout tableInstance={tableInstance} layout="scroll" label={label("settings.database.tables")} />
		</div>
	);
}

export { TablesCard };
