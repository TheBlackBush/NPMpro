import { Search } from "lucide-react";
import { TableCell, TableRow } from "src/components/ui/table";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { useStack } from "./StackedContext";

function EmptyRow({ tableInstance, stacked = false }) {
	const stack = useStack();
	return (
		<TableRow className={cn("hover:bg-transparent", stacked && stack.emptyRow)} role={stacked ? "row" : undefined}>
			<TableCell
				colSpan={tableInstance.getAllFlatColumns().length}
				role={stacked ? "cell" : undefined}
				className={cn("whitespace-normal", stacked && stack.emptyCell)}
			>
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
