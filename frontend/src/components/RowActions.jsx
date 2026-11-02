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

/**
 * The action menu of a table row: a ghost icon button that opens a menu aligned to its end.
 *
 * The windows the items open are not Radix: an item marked opensWindow runs once the menu has closed (deferred), and
 * the menu does not return focus to its button afterwards, so neither its pointer lock nor its focus return compete
 * with the window.
 * The menu holds no fixed ids: a row action cell may mount twice (phone layout).
 *
 * @param {Object} props
 * @param {string} props.label  aria-label of the button
 * @param {React.ReactNode} [props.title]  the menu heading
 * @param {Array<{key: string, label: React.ReactNode, icon?: React.ElementType, onSelect: () => void,
 *   destructive?: boolean, hidden?: boolean, separatorBefore?: boolean, opensWindow?: boolean}>} props.items
 *   hidden items and a separator before a first visible item are left out; opensWindow marks an item that opens a
 *   window: it runs deferred and the menu does not return focus to its button (other items run at once and focus
 *   returns as usual)
 */
function RowActions({ label, title, items }) {
	// set when the chosen item opens a window, so the menu does not return focus to its button over that window
	const skipFocusReturn = useRef(false);
	const visible = items.filter((item) => !item.hidden);
	if (visible.length === 0) {
		return null;
	}
	return (
		<DropdownMenu
			onOpenChange={(open) => {
				if (open) {
					skipFocusReturn.current = false;
				}
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button type="button" variant="ghost" size="icon-sm" aria-label={label}>
					<EllipsisVertical aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="w-48"
				onCloseAutoFocus={(e) => {
					if (skipFocusReturn.current) {
						e.preventDefault();
						skipFocusReturn.current = false;
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
								onSelect={() => {
									if (item.opensWindow) {
										skipFocusReturn.current = true;
										setTimeout(item.onSelect, 0);
									} else {
										item.onSelect();
									}
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
