import { IconSearch } from "@tabler/icons-react";
import { T } from "src/locale";

function EmptyRow({ tableInstance }) {
	return (
		<tr>
			<td colSpan={tableInstance.getAllFlatColumns().length}>
				<div className="empty">
					<div className="empty-icon">
						<IconSearch className="icon" aria-hidden="true" />
					</div>
					<p className="empty-title">
						<T id="empty-search" />
					</p>
				</div>
			</td>
		</tr>
	);
}

export { EmptyRow };
