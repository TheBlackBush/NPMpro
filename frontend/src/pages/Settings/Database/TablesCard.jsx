import { createColumnHelper } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { TableLayout } from "src/components/Table/TableLayout";
import { useAppTable } from "src/components/Table/useAppTable";
import { intl, T } from "src/locale";
import { readTablesOpen, tablesSummary, writeTablesOpen } from "src/modules/DatabaseMove";
import { SettingsCard } from "../SettingsCard";

const label = (id) => intl.formatMessage({ id });

/**
 * The tables of the database in use with their row counts, sorted by name
 */
function TablesCard({ tables }) {
	const [open, setOpen] = useState(() => readTablesOpen(globalThis.localStorage));
	const onOpenChange = (next) => {
		writeTablesOpen(globalThis.localStorage, next);
		setOpen(next);
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

	const tableInstance = useAppTable({
		columns,
		data: tables,
		getRowId: (row) => row.name,
		initialState: { sorting: [{ id: "name", desc: false }] },
	});

	return (
		<SettingsCard
			id="database-tables"
			collapsible
			open={open}
			onOpenChange={onOpenChange}
			title={<T id="settings.database.tables" />}
			info={tablesSummary(tables, intl.formatMessage)}
			bodyClassName="p-0"
		>
			{open ? (
				<TableLayout tableInstance={tableInstance} layout="scroll" label={label("settings.database.tables")} />
			) : null}
		</SettingsCard>
	);
}

export { TablesCard };
