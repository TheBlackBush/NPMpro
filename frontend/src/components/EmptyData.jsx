import { Search } from "lucide-react";
import { Button, HasPermission } from "src/components";
import { TableCell, TableRow } from "src/components/ui/table";
import { T } from "src/locale";
import { MANAGE } from "src/modules/Permissions";

// The color prop is still accepted by the callers; every button now uses the one primary colour.
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
}) {
	const ShownIcon = isFiltered || !Icon ? Search : Icon;
	// role row and cell keep the row valid inside the stacked phone layout's role="rowgroup"
	return (
		<TableRow className="hover:bg-transparent" role="row">
			<TableCell colSpan={tableInstance.getAllFlatColumns().length} role="cell">
				<div className="flex flex-col items-center gap-2 py-10 text-center">
					<div className="mb-1 flex rounded-full bg-muted p-3 text-muted-foreground">
						<ShownIcon className="size-6" aria-hidden="true" />
					</div>
					{isFiltered ? (
						<>
							<p className="m-0 font-medium">
								<T id={onClearFilters ? "list.no-match" : "empty-search"} />
							</p>
							{onClearFilters ? (
								<div className="mt-2">
									<Button color="primary" onClick={onClearFilters}>
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
