import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "src/components/ui/button";
import { TableHead, TableRow, TableHeader as UiTableHeader } from "src/components/ui/table";
import { cn } from "src/lib/utils";
import { headerClass } from "src/modules/MobileColumns";
import { ariaSort } from "src/modules/TableSort";
import { useStack } from "./StackedContext";

const SORT_ICON = { asc: ArrowUp, desc: ArrowDown };
const WHITESPACE = /\s+/u;

// scroll tables are not stacked: they keep their header on every width
function TableHeader({ tableInstance, scroll = false }) {
	// stacked layout: explicit roles, see TableLayout
	const role = (name) => (scroll ? undefined : name);
	const stack = useStack();
	return (
		<UiTableHeader className={cn(!scroll && stack.headerHidden)} role={role("rowgroup")}>
			{tableInstance.getHeaderGroups().map((headerGroup) => (
				<TableRow key={headerGroup.id} className="hover:bg-transparent" role={role("row")}>
					{headerGroup.headers.map((header) => {
						const { column } = header;
						const className = cn(
							"text-xs font-semibold uppercase tracking-wide text-muted-foreground",
							column.columnDef.meta?.className,
							headerClass(column.columnDef, stack.hiddenCell),
						);
						const label = typeof column.columnDef.header === "string" ? column.columnDef.header : null;
						if (!label || !column.getCanSort()) {
							return (
								<TableHead key={header.id} className={className} role={role("columnheader")}>
									{label}
								</TableHead>
							);
						}
						const sorted = column.getIsSorted();
						const Icon = SORT_ICON[sorted] ?? ArrowUpDown;
						// the button fills the whole header cell, so a click anywhere in it sorts
						const alignEnd = (column.columnDef.meta?.className ?? "")
							.split(WHITESPACE)
							.includes("text-right");
						return (
							<TableHead
								key={header.id}
								className={cn(className, "p-0")}
								aria-sort={ariaSort(sorted)}
								role={role("columnheader")}
							>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className={cn(
										"h-10 w-full justify-start rounded-none px-2 text-xs font-semibold uppercase tracking-wide focus-visible:ring-inset",
										alignEnd && "justify-end",
									)}
									onClick={column.getToggleSortingHandler()}
								>
									{label}
									<Icon
										data-icon="inline-end"
										className={cn(!sorted && "opacity-50")}
										aria-hidden="true"
									/>
								</Button>
							</TableHead>
						);
					})}
				</TableRow>
			))}
		</UiTableHeader>
	);
}

export { TableHeader };
