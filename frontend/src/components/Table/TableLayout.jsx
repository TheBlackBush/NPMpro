import cn from "clsx";
import { TableBody } from "./TableBody";
import { TableHeader } from "./TableHeader";

/**
 * @param {Object} props
 * @param {"stack"|"scroll"} [props.layout]  stack: rows become cards below 768 px; scroll: the table scrolls sideways
 * @param {string} [props.label]             accessible name of the scroll area (layout scroll)
 */
function TableLayout(props) {
	const hasRows = props.tableInstance.getRowModel().rows.length > 0;
	const showHeader = props.showHeader ?? true;
	const scroll = props.layout === "scroll";
	// a scroll area must be reachable by keyboard (Tabler issue #3330)
	const scrollArea = scroll ? { tabIndex: 0, role: "region", "aria-label": props.label } : {};
	return (
		<div className="table-responsive" {...scrollArea}>
			<table
				className={cn("table table-vcenter table-selectable mb-0", scroll ? "table-nowrap" : "table-mobile-md")}
			>
				{hasRows && showHeader ? <TableHeader tableInstance={props.tableInstance} /> : null}
				<TableBody {...props} />
			</table>
		</div>
	);
}

export { TableLayout };
