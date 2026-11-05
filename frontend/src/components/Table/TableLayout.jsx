import { useEffect } from "react";
import { Table } from "src/components/ui/table";
import { cn } from "src/lib/utils";
import { STACK_MODES } from "src/modules/TableStack";
import { StackModeContext } from "./StackedContext";
import { TableBody } from "./TableBody";
import { TableHeader } from "./TableHeader";

/**
 * @param {Object} props
 * @param {"stack"|"scroll"} [props.layout]  stack: rows become cards below 768 px; scroll: the table scrolls sideways
 * @param {"viewport"|"container"} [props.stackBy]  what the stacking follows: the window (default) or the width of the
 *                                                 table's own container (a table in a narrow column)
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
	// stacked layout: block/flex display makes some browsers (WebKit) drop the table semantics, so roles are explicit
	const stack = STACK_MODES[props.stackBy] ?? STACK_MODES.viewport;
	const tableRole = scroll ? undefined : { role: "table" };
	return (
		<StackModeContext.Provider value={props.stackBy ?? "viewport"}>
			<Table
				{...tableRole}
				containerProps={scrollArea}
				// a container, so columns can hide by the width the table has (see the users list)
				containerClassName="@container"
				// on narrow widths a stacked table, its body and rows are blocks (the rows are flex columns, see
				// TableBody) so each row can be a card; plain display values keep this working in iPhone Safari
				className={cn(!scroll && stack.table)}
			>
				{hasRows && showHeader ? <TableHeader tableInstance={props.tableInstance} scroll={scroll} /> : null}
				<TableBody {...props} scroll={scroll} />
			</Table>
		</StackModeContext.Provider>
	);
}

export { TableLayout };
