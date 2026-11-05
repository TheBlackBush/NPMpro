import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { TableLayout } from "src/components/Table/TableLayout";
import { cn } from "src/lib/utils";
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
				meta: { className: "text-right" },
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
		<div className="overflow-hidden rounded-lg border bg-card text-card-foreground">
			<button
				type="button"
				className={cn(
					"flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
					open && "border-b",
				)}
				aria-expanded={open}
				aria-controls={bodyId}
				onClick={toggle}
			>
				<div className="min-w-0">
					<h3 className="text-base font-medium">
						<T id="settings.database.tables" />
					</h3>
					<div className="text-sm text-muted-foreground">{tablesSummary(tables, intl.formatMessage)}</div>
				</div>
				{open ? (
					<ChevronDown className="ms-auto size-4 shrink-0" aria-hidden="true" />
				) : (
					<ChevronRight className="ms-auto size-4 shrink-0" aria-hidden="true" />
				)}
			</button>
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
