import { flexRender } from "@tanstack/react-table";
import { phoneParts, summaryText, titleClass } from "src/modules/MobileColumns";

/**
 * The phone-only part of a stacked row, inside its title cell: the title, the cells marked title-end on its right,
 * title-below under it and the summary line. Hidden from 768 px, where the original cells show.
 */
function MobileTitle({ row, titleCell }) {
	const cells = row.getAllCells();
	const columns = cells.map((cell) => cell.column.columnDef);
	const parts = phoneParts(columns);
	const render = (column) => {
		const cell = cells.find((item) => item.column.columnDef === column);
		return cell ? <span key={cell.id}>{flexRender(column.cell, cell.getContext())}</span> : null;
	};
	const summary = summaryText(columns, row.original);
	return (
		<div className="d-md-none">
			<div className="d-flex align-items-start gap-2">
				<div className={titleClass()}>
					{flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
				</div>
				{parts.end.map(render)}
			</div>
			{parts.below.length > 0 ? (
				<div className="mt-1 d-flex flex-wrap gap-1">{parts.below.map(render)}</div>
			) : null}
			{summary ? <div className="mt-1 small text-secondary text-break">{summary}</div> : null}
		</div>
	);
}

export { MobileTitle };
