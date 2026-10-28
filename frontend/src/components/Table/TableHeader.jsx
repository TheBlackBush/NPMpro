import cn from "clsx";
import { headerClass } from "src/modules/MobileColumns";
import { ariaSort } from "src/modules/TableSort";

function TableHeader({ tableInstance }) {
	return (
		<thead>
			{tableInstance.getHeaderGroups().map((headerGroup) => (
				<tr key={headerGroup.id}>
					{headerGroup.headers.map((header) => {
						const { column } = header;
						const className = cn(column.columnDef.meta?.className, headerClass(column.columnDef));
						const label = typeof column.columnDef.header === "string" ? column.columnDef.header : null;
						if (!label || !column.getCanSort()) {
							return (
								<th key={header.id} className={className}>
									{label}
								</th>
							);
						}
						const sorted = column.getIsSorted();
						return (
							<th key={header.id} className={className} aria-sort={ariaSort(sorted)}>
								{/* bg-transparent: the header background is translucent and .table-sort inherits it, which would paint it twice */}
								<button
									type="button"
									className={cn("table-sort bg-transparent", sorted)}
									onClick={column.getToggleSortingHandler()}
								>
									{label}
								</button>
							</th>
						);
					})}
				</tr>
			))}
		</thead>
	);
}

export { TableHeader };
