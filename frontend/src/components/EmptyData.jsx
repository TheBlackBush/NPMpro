import { Search } from "lucide-react";
import { Button, HasPermission } from "src/components";
import { STACKED_EMPTY_CELL, STACKED_EMPTY_ROW, useStacked } from "src/components/Table/StackedContext";
import { TableCell, TableRow } from "src/components/ui/table";
import { cn } from "src/lib/utils";
import { T } from "src/locale";
import { MANAGE } from "src/modules/Permissions";
import { colorAccent, PRIMARY_ACCENT, sectionAccent } from "src/modules/SectionAccents";

// Buttons use the one primary colour. The section key (or an older caller's Tabler colour) gives the icon circle
// its section accent.
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
	color,
}) {
	const ShownIcon = isFiltered || !Icon ? Search : Icon;
	const stacked = useStacked();
	// the section key wins; older callers pass the Tabler colour of their section
	const accent = section ? sectionAccent(section) : colorAccent(color);
	const tinted = accent !== PRIMARY_ACCENT && !isFiltered;
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
							// the icon sits on the plain card (a tint would take it under 3:1) inside an accent ring
							tinted
								? cn("border bg-card", accent.border, accent.text)
								: "bg-muted text-muted-foreground",
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
