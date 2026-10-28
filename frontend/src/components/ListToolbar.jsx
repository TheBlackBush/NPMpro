import { IconSearch, IconSortAscending, IconSortDescending } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { intl, T } from "src/locale";
import { activeFilterCount } from "src/modules/ListFilters";
import { sortOptions, sortSelectValue } from "src/modules/MobileColumns";

const STATUS_OPTIONS = ["online", "error", "disabled"];
const TLS_OPTIONS = ["with", "without"];

function FilterSelect({ label, value, onChange, options }) {
	return (
		<select
			className="form-select form-select-sm w-100"
			aria-label={intl.formatMessage({ id: label })}
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			<option value="all">
				{intl.formatMessage({ id: label })}: {intl.formatMessage({ id: "list.filter.all" })}
			</option>
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	);
}

/**
 * @param {object} props
 * @param {object} props.filters result of parseFilters
 * @param {(key: string, value: string|null) => void} props.setFilter
 * @param {() => void} props.clear
 * @param {number} props.total rows before filtering
 * @param {number} props.shown rows after filtering
 * @param {string[]} props.kinds any of "status", "tls", "group", "expiry"
 * @param {string[]} [props.groups]
 * @param {object} [props.sorting] phone-only "Sort by" control, hidden from 768 px up
 * @param {{ id: string, header: *, enableSorting: boolean }[]} props.sorting.columns resolved columns, built by the
 *   caller as tableInstance.getAllLeafColumns().map((column) => ({ id: column.id, header: column.columnDef.header,
 *   enableSorting: column.getCanSort() })); columnDef.id is undefined for accessorKey columns, so pass column.id
 * @param {{ id: string, desc: boolean }[]} props.sorting.state TanStack SortingState
 * @param {(state: { id: string, desc: boolean }[]) => void} props.sorting.onChange
 */
function ListToolbar({ filters, setFilter, clear, total, shown, kinds, groups = [], sorting }) {
	const active = activeFilterCount(filters, kinds) > 0;
	const [text, setText] = useState(filters.q);
	const inputRef = useRef(null);

	useEffect(() => {
		// router updates arrive as transitions, so while the box has focus an older q can land after newer
		// keystrokes; only resync on external changes (back navigation) when the user is not typing
		if (document.activeElement === inputRef.current) return;
		setText((current) => (current.trim() === filters.q.trim() ? current : filters.q));
	}, [filters.q]);
	if (!total) return null;
	const sortChoices = sorting ? sortOptions(sorting.columns) : [];
	const sortValue = sortSelectValue(sorting?.state);
	return (
		<div className="card-body border-bottom py-3">
			<div className="row g-2 align-items-center">
				<div className="col-12 col-md">
					<div className="input-group input-group-flat input-group-sm">
						<span className="input-group-text">
							<IconSearch className="icon" aria-hidden="true" />
						</span>
						<input
							type="text"
							className="form-control"
							placeholder={intl.formatMessage({ id: "search" })}
							aria-label={intl.formatMessage({ id: "search" })}
							autoComplete="off"
							ref={inputRef}
							value={text}
							onChange={(e) => {
								setText(e.target.value);
								setFilter("q", e.target.value);
							}}
						/>
					</div>
				</div>
				{kinds.includes("status") ? (
					<div className="col-6 col-md-auto">
						<FilterSelect
							label="list.filter.status"
							value={filters.status}
							onChange={(v) => setFilter("status", v)}
							options={STATUS_OPTIONS.map((value) => ({
								value,
								label: intl.formatMessage({ id: `list.filter.${value}` }),
							}))}
						/>
					</div>
				) : null}
				{kinds.includes("tls") ? (
					<div className="col-6 col-md-auto">
						<FilterSelect
							label="list.filter.tls"
							value={filters.tls}
							onChange={(v) => setFilter("tls", v)}
							options={TLS_OPTIONS.map((value) => ({
								value,
								label: intl.formatMessage({ id: `list.filter.${value}` }),
							}))}
						/>
					</div>
				) : null}
				{kinds.includes("group") && groups.length > 0 ? (
					<div className="col-6 col-md-auto">
						<FilterSelect
							label="list.filter.group"
							value={filters.group ?? "all"}
							onChange={(v) => setFilter("group", v)}
							options={groups.map((value) => ({ value, label: value }))}
						/>
					</div>
				) : null}
				{kinds.includes("expiry") ? (
					<div className="col-6 col-md-auto">
						<FilterSelect
							label="list.filter.expiry"
							value={filters.expiry}
							onChange={(v) => setFilter("expiry", v)}
							options={[{ value: "soon", label: intl.formatMessage({ id: "list.filter.soon" }) }]}
						/>
					</div>
				) : null}
				{active && shown > 0 ? (
					<div className="col-12 col-md-auto d-flex align-items-center gap-2">
						<span className="text-secondary small">
							<T id="list.shown" data={{ shown, total }} />
						</span>
						<button
							type="button"
							className="btn btn-link btn-sm p-0"
							onClick={() => {
								setText("");
								clear();
							}}
						>
							<T id="list.clear-filters" />
						</button>
					</div>
				) : null}
			</div>
			{sortChoices.length > 0 ? (
				<div className="row g-2 align-items-center mt-0 d-md-none">
					<div className="col-auto">
						<label className="form-label mb-0" htmlFor="list-sort-by">
							<T id="list.sort-by" />
						</label>
					</div>
					<div className="col">
						<select
							id="list-sort-by"
							className="form-select form-select-sm"
							value={sortValue.id ?? ""}
							onChange={(e) =>
								sorting.onChange(e.target.value ? [{ id: e.target.value, desc: sortValue.desc }] : [])
							}
						>
							<option value="">{intl.formatMessage({ id: "list.sort-default" })}</option>
							{sortChoices.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</select>
					</div>
					<div className="col-auto">
						<button
							type="button"
							className="btn btn-sm btn-icon"
							aria-label={intl.formatMessage({ id: sortValue.desc ? "list.sort-desc" : "list.sort-asc" })}
							aria-pressed={sortValue.desc}
							disabled={!sortValue.id}
							onClick={() => sorting.onChange([{ id: sortValue.id, desc: !sortValue.desc }])}
						>
							{sortValue.desc ? (
								<IconSortDescending className="icon" aria-hidden="true" />
							) : (
								<IconSortAscending className="icon" aria-hidden="true" />
							)}
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}

export { ListToolbar };
