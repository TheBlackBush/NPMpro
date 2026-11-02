import { Search } from "lucide-react";
import { TableCell, TableRow } from "src/components/ui/table";
import { T } from "src/locale";

function EmptyRow({ tableInstance, stacked = false }) {
	return (
		<TableRow className="hover:bg-transparent" role={stacked ? "row" : undefined}>
			<TableCell colSpan={tableInstance.getAllFlatColumns().length} role={stacked ? "cell" : undefined}>
				<div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
					<Search className="size-8" aria-hidden="true" />
					<p className="m-0 text-base font-medium text-foreground">
						<T id="empty-search" />
					</p>
				</div>
			</TableCell>
		</TableRow>
	);
}

export { EmptyRow };
