import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Button } from "src/components/ui/button";
import { TableHead, TableRow, TableHeader as UiTableHeader } from "src/components/ui/table";
import { cn } from "src/lib/utils";
import { headerClass } from "src/modules/MobileColumns";
import { ariaSort } from "src/modules/TableSort";

const SORT_ICON = { asc: ArrowUp, desc: ArrowDown };

// scroll tables are not stacked: they keep their header on every width
function TableHeader({ tableInstance, scroll = false }) {
	return (
		<UiTableHeader className={cn(!scroll && "max-md:hidden")}>
			{tableInstance.getHeaderGroups().map((headerGroup) => (
				<TableRow key={headerGroup.id} className="hover:bg-transparent">
					{headerGroup.headers.map((header) => {
						const { column } = header;
						const className = cn(
							"text-xs font-semibold uppercase tracking-wide text-muted-foreground",
							column.columnDef.meta?.className,
							headerClass(column.columnDef),
						);
						const label = typeof column.columnDef.header === "string" ? column.columnDef.header : null;
						if (!label || !column.getCanSort()) {
							return (
								<TableHead key={header.id} className={className}>
									{label}
								</TableHead>
							);
						}
						const sorted = column.getIsSorted();
						const Icon = SORT_ICON[sorted] ?? ArrowUpDown;
						return (
							<TableHead key={header.id} className={className} aria-sort={ariaSort(sorted)}>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="-ml-2 text-xs font-semibold uppercase tracking-wide"
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
