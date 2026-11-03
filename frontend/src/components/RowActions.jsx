import { EllipsisVertical } from "lucide-react";
import { Fragment, useRef } from "react";
import { Button } from "src/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { restoreRowFocus } from "src/modules/FocusReturn";

/**
 * The action menu of a table row: a ghost icon button that opens a menu aligned to its end.
 *
 * A chosen item runs once the menu has closed and returned focus to its button (in onCloseAutoFocus): the windows the
 * items open (not Radix) then record the button as the element to return focus to, and the menu's pointer lock is
 * already gone. When the item's work settles (its promise, if it returns one) and focus fell to the page body (the
 * row re-rendered or moved after a re-sort), focus goes back to this row's visible button, found by focusKey.
 * The menu holds no fixed ids: a row action cell may mount twice (phone layout).
 *
 * @param {Object} props
 * @param {string} props.label  aria-label of the button
 * @param {string} [props.focusKey]  unique per row (for instance proxy-host-12), set as data-row-actions on the button
 * @param {React.ReactNode} [props.title]  the menu heading
 * @param {Array<{key: string, label: React.ReactNode, icon?: React.ElementType, onSelect: () => (void|Promise),
 *   destructive?: boolean, hidden?: boolean, disabled?: boolean, separatorBefore?: boolean}>} props.items
 *   hidden items and a separator before a first visible item are left out
 */
function RowActions({ label, focusKey, title, items }) {
	// the chosen item's action, run after the menu has returned focus to its button
	const pending = useRef(null);
	const visible = items.filter((item) => !item.hidden);
	if (visible.length === 0) {
		return null;
	}
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button type="button" variant="ghost" size="icon-sm" aria-label={label} data-row-actions={focusKey}>
					<EllipsisVertical aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-48"
				onCloseAutoFocus={() => {
					// no preventDefault: Radix focuses the button right after this handler, then the action runs
					const run = pending.current;
					pending.current = null;
					if (run) {
						setTimeout(async () => {
							try {
								await run();
							} finally {
								restoreRowFocus(focusKey);
							}
						}, 0);
					}
				}}
			>
				{title ? <DropdownMenuLabel>{title}</DropdownMenuLabel> : null}
				{visible.map((item, index) => {
					const Icon = item.icon;
					return (
						<Fragment key={item.key}>
							{item.separatorBefore && index > 0 ? <DropdownMenuSeparator /> : null}
							<DropdownMenuItem
								variant={item.destructive ? "destructive" : "default"}
								disabled={item.disabled}
								onSelect={() => {
									pending.current = item.onSelect;
								}}
							>
								{Icon ? <Icon aria-hidden="true" /> : null}
								{item.label}
							</DropdownMenuItem>
						</Fragment>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export { RowActions };
