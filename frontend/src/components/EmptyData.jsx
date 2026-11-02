import { Search } from "lucide-react";
import { Button, HasPermission } from "src/components";
import { STACKED_EMPTY_CELL, STACKED_EMPTY_ROW, useStacked } from "src/components/Table/StackedContext";
import { TableCell, TableRow } from "src/components/ui/table";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { MANAGE } from "src/modules/Permissions";
import { sectionAccent } from "src/modules/SectionAccents";

// The color prop is still accepted by the callers and ignored: every button uses the one primary colour. The section
// key tints the icon circle in the section's accent.
function EmptyData({
	tableInstance,
	onNew,
	isFiltered,
	onClearFilters,
	object,
	objects,
	customAddBtn,
	permissionSection,
	permission,
	icon: Icon,
	section,
}) {
	const ShownIcon = isFiltered || !Icon ? Search : Icon;
	const stacked = useStacked();
	const accent = sectionAccent(section);
	const tinted = Boolean(section) && !isFiltered;
	// role row and cell keep the row valid inside the stacked phone layout's role="rowgroup"
	return (
		<TableRow className={cn("hover:bg-transparent", stacked && STACKED_EMPTY_ROW)} role="row">
			<TableCell
				colSpan={tableInstance.getAllFlatColumns().length}
				role="cell"
				className={cn("whitespace-normal", stacked && STACKED_EMPTY_CELL)}
			>
				<div className="flex flex-col items-center gap-2 py-10 text-center">
					<div
						className={cn(
							"mb-1 flex rounded-full p-3",
							tinted ? cn(accent.bg, accent.text) : "bg-muted text-muted-foreground",
						)}
					>
						<ShownIcon className="size-6" aria-hidden="true" />
					</div>
					{isFiltered ? (
						<>
							<p className="m-0 font-medium">
								<T id={onClearFilters ? "list.no-match" : "empty-search"} />
							</p>
							{onClearFilters ? (
								<div className="mt-2">
									<Button onClick={onClearFilters}>
										<T id="list.clear-filters" />
									</Button>
								</div>
							) : null}
						</>
					) : (
						<>
							<p className="m-0 font-medium">
								<T id="object.empty" tData={{ objects }} />
							</p>
							<HasPermission section={permissionSection} permission={permission || MANAGE} hideError>
								<p className="m-0 text-sm text-muted-foreground">
									<T id="empty-subtitle" />
								</p>
								<div className="mt-2">
									{customAddBtn ?? (
										<Button color="primary" onClick={onNew}>
											<T id="object.add" tData={{ object }} />
										</Button>
									)}
								</div>
							</HasPermission>
						</>
					)}
				</div>
			</TableCell>
		</TableRow>
	);
}

export { EmptyData };
