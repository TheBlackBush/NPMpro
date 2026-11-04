import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "src/components/ui/button";
import { Checkbox } from "src/components/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "src/components/ui/input-group";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { inSentence, pickerItems, tickShown } from "src/modules/BackupMerge";
import { SwitchField } from "./Form";

/**
 * A checklist of single items (hosts by their domains, certificates, lists by their name): a search field, the count
 * "3 of 12 selected" (with "5 shown" while filtered) and a "Selected only" switch, the rows in a list that scrolls
 * from 16rem, and "Select all" and "None" for the rows shown.
 *
 * @param {Object}    props
 * @param {Array}     props.items         [{ id, label }]
 * @param {Array}     props.selected      the ticked ids
 * @param {Function}  props.onChange      (ids) => void, in the order of items
 * @param {string}    props.typeName      the type's name, for "Search proxy hosts" and "No proxy hosts match."
 * @param {boolean}   [props.disabled]
 * @param {string}    [props.labelledBy]  the id of the list's title, for the group of checkboxes
 * @param {string}    [props.label]       the name of the group of checkboxes when there is no title
 * @param {boolean}   [props.menu]        the rows without dividers, for a dropdown menu; else with dividers
 * @param {ReactNode} [props.footer]      shown at the end of the footer row (the menu's Done)
 * @param {Object}    [props.searchRef]   a ref to the search field
 */
function ItemChecklist({
	items,
	selected,
	onChange,
	typeName,
	disabled = false,
	labelledBy,
	label,
	menu = false,
	footer,
	searchRef,
}) {
	const baseId = useId();
	const [search, setSearch] = useState("");
	const [selectedOnly, setSelectedOnly] = useState(false);
	const ticked = new Set(selected.map(String));
	const shown = pickerItems(items, selected, { search, selectedOnly });
	const allShown = shown.length > 0 && shown.every((item) => ticked.has(String(item.id)));
	const noneShown = shown.every((item) => !ticked.has(String(item.id)));
	const name = inSentence(typeName, intl.locale);
	const searchLabel = intl.formatMessage({ id: "settings.backup.search-type" }, { type: name });
	const toggle = (item) => {
		const on = !ticked.has(String(item.id));
		onChange(tickShown(items, selected, [item], on));
	};
	return (
		<div>
			<div className="border-b p-2">
				<InputGroup className="h-8">
					<InputGroupAddon>
						<Search aria-hidden="true" />
					</InputGroupAddon>
					<InputGroupInput
						ref={searchRef}
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={searchLabel}
						aria-label={searchLabel}
						disabled={disabled}
					/>
				</InputGroup>
				<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
					<span className="text-muted-foreground" aria-live="polite">
						{shown.length < items.length ? (
							<T
								id="settings.backup.items-selected-shown"
								data={{ selected: ticked.size, total: items.length, shown: shown.length }}
							/>
						) : (
							<T
								id="settings.backup.items-selected"
								data={{ selected: ticked.size, total: items.length }}
							/>
						)}
					</span>
					<SwitchField
						id={`${baseId}-selected-only`}
						className="ms-auto"
						label={<T id="settings.backup.selected-only" />}
						checked={selectedOnly}
						onChange={(e) => setSelectedOnly(e.target.checked)}
						disabled={disabled}
					/>
				</div>
			</div>
			{shown.length === 0 ? (
				<p className="px-3 py-2 text-sm text-muted-foreground">
					<T id="settings.backup.no-match-type" data={{ type: name }} />
				</p>
			) : (
				// a long list scrolls inside the box
				<fieldset
					aria-labelledby={labelledBy}
					aria-label={labelledBy ? undefined : label}
					className={cn("max-h-64 overflow-auto", menu ? "py-1" : "divide-y")}
				>
					{shown.map((item) => (
						// biome-ignore lint/a11y/noLabelWithoutControl: the Radix checkbox inside is a button, which labels the row
						<label
							key={item.id}
							className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
						>
							<Checkbox
								checked={ticked.has(String(item.id))}
								onCheckedChange={() => toggle(item)}
								disabled={disabled}
								className="mt-0.5"
							/>
							<span className="min-w-0 break-words text-sm">{item.label}</span>
						</label>
					))}
				</fieldset>
			)}
			<div className="flex items-center gap-3 border-t p-2">
				<Button
					type="button"
					variant="link"
					size="sm"
					className="h-auto p-0"
					onClick={() => onChange(tickShown(items, selected, shown, true))}
					disabled={disabled || allShown}
				>
					<T id="settings.backup.select-all" />
				</Button>
				<Button
					type="button"
					variant="link"
					size="sm"
					className="h-auto p-0"
					onClick={() => onChange(tickShown(items, selected, shown, false))}
					disabled={disabled || noneShown}
				>
					<T id="settings.backup.select-none" />
				</Button>
				{footer}
			</div>
		</div>
	);
}

export { ItemChecklist };
