import { IconSearch } from "@tabler/icons-react";
import cn from "clsx";
import { Button, HasPermission } from "src/components";
import { T } from "src/locale";
import { MANAGE } from "src/modules/Permissions";

function EmptyData({
	tableInstance,
	onNew,
	isFiltered,
	onClearFilters,
	object,
	objects,
	color,
	customAddBtn,
	permissionSection,
	permission,
	icon: Icon,
}) {
	return (
		<tr>
			<td colSpan={tableInstance.getAllFlatColumns().length}>
				<div className="empty">
					<div className="empty-icon">
						{isFiltered || !Icon ? (
							<IconSearch className="icon" aria-hidden="true" />
						) : (
							<Icon className="icon" aria-hidden="true" />
						)}
					</div>
					{isFiltered ? (
						<>
							<p className="empty-title">
								<T id={onClearFilters ? "list.no-match" : "empty-search"} />
							</p>
							{onClearFilters ? (
								<div className="empty-action">
									<Button onClick={onClearFilters}>
										<T id="list.clear-filters" />
									</Button>
								</div>
							) : null}
						</>
					) : (
						<>
							<p className="empty-title">
								<T id="object.empty" tData={{ objects }} />
							</p>
							<HasPermission section={permissionSection} permission={permission || MANAGE} hideError>
								<p className="empty-subtitle text-secondary">
									<T id="empty-subtitle" />
								</p>
								<div className="empty-action">
									{customAddBtn ?? (
										<Button className={cn(`btn-${color}`)} onClick={onNew}>
											<T id="object.add" tData={{ object }} />
										</Button>
									)}
								</div>
							</HasPermission>
						</>
					)}
				</div>
			</td>
		</tr>
	);
}

export { EmptyData };
