import { IconSearch } from "@tabler/icons-react";
import cn from "clsx";
import { useState } from "react";
import { intl, T } from "src/locale";
import { inSentence, pickerItems, tickShown } from "src/modules/BackupMerge";

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
 * @param {boolean}   [props.menu]        the rows as dropdown items, for a dropdown menu; else as a list group
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
			<div className="p-2 border-bottom">
				<div className="input-icon">
					<span className="input-icon-addon">
						<IconSearch className="icon" aria-hidden="true" />
					</span>
					<input
						ref={searchRef}
						type="search"
						className="form-control form-control-sm"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={searchLabel}
						aria-label={searchLabel}
						disabled={disabled}
					/>
				</div>
				<div className="d-flex flex-wrap align-items-center column-gap-3 row-gap-1 mt-2 small">
					<span className="text-secondary" aria-live="polite">
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
					<label className="form-check form-switch m-0 ms-auto">
						<input
							className="form-check-input"
							type="checkbox"
							checked={selectedOnly}
							onChange={(e) => setSelectedOnly(e.target.checked)}
							disabled={disabled}
						/>
						<span className="form-check-label">
							<T id="settings.backup.selected-only" />
						</span>
					</label>
				</div>
			</div>
			{shown.length === 0 ? (
				<p className="text-secondary small px-3 py-2 mb-0">
					<T id="settings.backup.no-match-type" data={{ type: name }} />
				</p>
			) : (
				// no Tabler utility caps a height (only mh-100): a long list scrolls inside the box
				<fieldset
					aria-labelledby={labelledBy}
					aria-label={labelledBy ? undefined : label}
					className={cn("overflow-auto", menu ? "py-1" : "list-group list-group-flush list-group-selectable")}
					style={{ maxHeight: "16rem" }}
				>
					{shown.map((item) =>
						menu ? (
							<label key={item.id} className="dropdown-item">
								<input
									type="checkbox"
									className="form-check-input m-0"
									checked={ticked.has(String(item.id))}
									onChange={() => toggle(item)}
									disabled={disabled}
								/>
								<span className="text-wrap text-break">{item.label}</span>
							</label>
						) : (
							<label key={item.id} className="list-group-item">
								<span className="list-group-item-media">
									<input
										type="checkbox"
										className="form-check-input list-group-selectable-check m-0"
										checked={ticked.has(String(item.id))}
										onChange={() => toggle(item)}
										disabled={disabled}
									/>
								</span>
								<span className="list-group-item-content">
									<span className="list-group-item-title text-wrap text-break">{item.label}</span>
								</span>
							</label>
						),
					)}
				</fieldset>
			)}
			<div className="d-flex align-items-center gap-3 p-2 border-top">
				<button
					type="button"
					className="btn btn-link btn-sm p-0"
					onClick={() => onChange(tickShown(items, selected, shown, true))}
					disabled={disabled || allShown}
				>
					<T id="settings.backup.select-all" />
				</button>
				<button
					type="button"
					className="btn btn-link btn-sm p-0"
					onClick={() => onChange(tickShown(items, selected, shown, false))}
					disabled={disabled || noneShown}
				>
					<T id="settings.backup.select-none" />
				</button>
				{footer}
			</div>
		</div>
	);
}

export { ItemChecklist };
