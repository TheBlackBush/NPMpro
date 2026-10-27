import { useState } from "react";
import { intl, T } from "src/locale";
import { searchItems } from "src/modules/BackupMerge";

// a search field is shown above this many items
const SEARCH_FROM = 11;

/**
 * A checklist of single items (hosts by their domains, certificates, lists by their name): a search field above 10
 * items, "Select all" and "None" for the items shown, the rows as a selectable list group and the count "3 of 12".
 *
 * @param {Object}    props
 * @param {Array}     props.items         [{ id, label }]
 * @param {Array}     props.selected      the ticked ids
 * @param {Function}  props.onChange      (ids) => void, in the order of items
 * @param {string}    [props.searchLabel] the label of the search field
 * @param {boolean}   [props.disabled]
 */
function ItemChecklist({ items, selected, onChange, searchLabel, disabled = false }) {
	const [search, setSearch] = useState("");
	const ticked = new Set(selected.map(String));
	const shown = items.length >= SEARCH_FROM ? searchItems(items, search) : items;
	const shownIds = new Set(shown.map((item) => String(item.id)));
	const allShown = shown.length > 0 && shown.every((item) => ticked.has(String(item.id)));
	const noneShown = shown.every((item) => !ticked.has(String(item.id)));
	const emit = (next) => onChange(items.filter((item) => next.has(String(item.id))).map((item) => item.id));
	const toggle = (id) => {
		const next = new Set(ticked);
		if (next.has(String(id))) next.delete(String(id));
		else next.add(String(id));
		emit(next);
	};
	return (
		<div>
			{items.length >= SEARCH_FROM ? (
				<div className="p-2 border-bottom">
					<input
						type="search"
						className="form-control"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={searchLabel ?? intl.formatMessage({ id: "search" })}
						aria-label={searchLabel ?? intl.formatMessage({ id: "search" })}
						disabled={disabled}
					/>
				</div>
			) : null}
			<div className="d-flex align-items-center gap-3 px-3 py-2 border-bottom">
				<span className="text-secondary small" aria-live="polite">
					<T id="settings.backup.items-of" data={{ selected: ticked.size, total: items.length }} />
				</span>
				<div className="ms-auto d-flex gap-3">
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						onClick={() => emit(new Set([...ticked, ...shownIds]))}
						disabled={disabled || allShown}
					>
						<T id="settings.backup.select-all" />
					</button>
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						onClick={() => emit(new Set([...ticked].filter((id) => !shownIds.has(id))))}
						disabled={disabled || noneShown}
					>
						<T id="settings.backup.select-none" />
					</button>
				</div>
			</div>
			{shown.length === 0 ? (
				<p className="text-secondary small px-3 py-2 mb-0">
					<T id="empty-search" />
				</p>
			) : (
				// no Tabler utility caps a height (only mh-100): a long list scrolls inside the box
				<div
					className="list-group list-group-flush list-group-selectable overflow-auto"
					style={{ maxHeight: "20rem" }}
				>
					{shown.map((item) => (
						<label key={item.id} className="list-group-item">
							<span className="list-group-item-media">
								<input
									type="checkbox"
									className="form-check-input list-group-selectable-check m-0"
									checked={ticked.has(String(item.id))}
									onChange={() => toggle(item.id)}
									disabled={disabled}
								/>
							</span>
							<span className="list-group-item-content">
								<span className="list-group-item-title text-wrap text-break">{item.label}</span>
							</span>
						</label>
					))}
				</div>
			)}
		</div>
	);
}

export { ItemChecklist };
