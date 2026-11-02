import { flexRender } from "@tanstack/react-table";
import { Fragment } from "react";
import { TableCell, TableRow, TableBody as UiTableBody } from "src/components/ui/table";
import { cn } from "src/lib/utils";
import { cellClass, mobileRole } from "src/modules/MobileColumns";
import { cellLabel } from "src/modules/TableCells";
import { EmptyRow } from "./EmptyRow";
import { MobileTitle } from "./MobileTitle";

// Below md a stacked row is a card: the row is a flex column (its cells become blocks without touching their own
// display, so the hidden-on-phone cells stay hidden) and each cell shows its header as a small label above the value.
const CARD_ROW = "max-md:mb-3 max-md:flex max-md:flex-col max-md:gap-1 max-md:rounded-lg max-md:border max-md:p-3";
const CARD_CELL =
	"max-md:px-0 max-md:py-1 max-md:data-label:before:block max-md:data-label:before:text-xs max-md:data-label:before:text-muted-foreground max-md:data-label:before:content-[attr(data-label)]";

function TableBody(props) {
	const { tableInstance, extraStyles, emptyState, groupBy, renderGroupLabel, scroll = false } = props;
	const { rows } = tableInstance.getRowModel();
	// the last card keeps its border (the shadcn body removes the border of its last row)
	const bodyClass = scroll ? undefined : "max-md:[&_tr:last-child]:border!";

	if (rows.length === 0) {
		return (
			<UiTableBody className={bodyClass}>
				{emptyState ? emptyState : <EmptyRow tableInstance={tableInstance} />}
			</UiTableBody>
		);
	}

	const cellBase = scroll ? "whitespace-nowrap" : cn("whitespace-normal", CARD_CELL);

	const renderRow = (row) => (
		<TableRow key={row.id} {...extraStyles?.row(row.original)} className={cn(!scroll && CARD_ROW)}>
			{row.getAllCells().map((cell) => {
				const { columnDef } = cell.column;
				const { className } = columnDef.meta ?? {};
				const content = flexRender(columnDef.cell, cell.getContext());
				if (mobileRole(columnDef) === "title") {
					return (
						<TableCell key={cell.id} className={cn(cellBase, className, cellClass(columnDef))}>
							<MobileTitle row={row} titleCell={cell} />
							<div className="hidden md:block">{content}</div>
						</TableCell>
					);
				}
				return (
					<TableCell
						key={cell.id}
						className={cn(cellBase, className, cellClass(columnDef))}
						data-label={cellLabel(columnDef)}
					>
						{content}
					</TableCell>
				);
			})}
		</TableRow>
	);

	if (!groupBy) {
		return <UiTableBody className={bodyClass}>{rows.map(renderRow)}</UiTableBody>;
	}

	const groups = new Map();
	for (const row of rows) {
		const key = groupBy(row.original);
		const bucket = groups.get(key);
		if (bucket) bucket.push(row);
		else groups.set(key, [row]);
	}
	const orderedKeys = [...groups.keys()].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
	const colSpan = tableInstance.getAllLeafColumns().length;

	return (
		<UiTableBody className={bodyClass}>
			{orderedKeys.map((key) => (
				<Fragment key={key}>
					<TableRow className="max-md:border-0 hover:bg-transparent">
						<th
							scope="rowgroup"
							colSpan={colSpan}
							className="bg-muted/50 px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
						>
							{renderGroupLabel(key)}
						</th>
					</TableRow>
					{groups.get(key)?.map(renderRow)}
				</Fragment>
			))}
		</UiTableBody>
	);
}

export { TableBody };
