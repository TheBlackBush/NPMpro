import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { useId, useMemo, useState } from "react";
import { TableLayout } from "src/components/Table/TableLayout";
import { intl, T } from "src/locale";
import { readTablesOpen, tablesSummary, writeTablesOpen } from "src/modules/DatabaseMove";

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
	const bodyId = useId();
	const [open, setOpen] = useState(() => readTablesOpen(globalThis.localStorage));
	const toggle = () => {
		writeTablesOpen(globalThis.localStorage, !open);
		setOpen(!open);
	};
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
			<div className={open ? "card-header" : "card-header border-0"}>
				<button
					type="button"
					className="btn btn-link text-reset text-start text-decoration-none d-flex align-items-center gap-2 w-100 p-0"
					aria-expanded={open}
					aria-controls={bodyId}
					onClick={toggle}
				>
					<div>
						<h3 className="card-title">
							<T id="settings.database.tables" />
						</h3>
						<div className="card-subtitle">{tablesSummary(tables, intl.formatMessage)}</div>
					</div>
					{open ? (
						<IconChevronDown className="icon ms-auto" aria-hidden="true" />
					) : (
						<IconChevronRight className="icon ms-auto" aria-hidden="true" />
					)}
				</button>
			</div>
			<div id={bodyId} hidden={!open}>
				{open ? (
					<TableLayout
						tableInstance={tableInstance}
						layout="scroll"
						label={label("settings.database.tables")}
					/>
				) : null}
			</div>
		</div>
	);
}

export { TablesCard };
