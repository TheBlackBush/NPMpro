import { useEffect } from "react";
import { Table } from "src/components/ui/table";
import { cn } from "src/lib/utils";
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
	useEffect(() => {
		if (import.meta.env.DEV && scroll && !props.label) {
			console.warn("TableLayout: a scroll layout needs a label, otherwise its region has no name");
		}
	}, [scroll, props.label]);
	// a scroll area must be reachable by keyboard
	const scrollArea = scroll ? { tabIndex: 0, role: "region", "aria-label": props.label } : undefined;
	return (
		<Table
			containerProps={scrollArea}
			// below md a stacked table, its body and rows are blocks (the rows are flex columns, see TableBody) so
			// each row can be a card; plain display values keep this working in iPhone Safari
			className={cn(!scroll && "max-md:block max-md:[&>tbody]:block")}
		>
			{hasRows && showHeader ? <TableHeader tableInstance={props.tableInstance} scroll={scroll} /> : null}
			<TableBody {...props} scroll={scroll} />
		</Table>
	);
}

export { TableLayout };
