import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { AppSelect } from "src/components/AppSelect";
import { Button } from "src/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "src/components/ui/input-group";
import { intl, T } from "src/locale";
import { activeFilterCount } from "src/modules/ListFilters";
import { sortOptions, sortSelectValue } from "src/modules/MobileColumns";

const STATUS_OPTIONS = ["online", "error", "disabled"];
const TLS_OPTIONS = ["with", "without"];

// two filters per row on phones (half the row minus half the gap-2; a lone last one grows to the full row), their own width from md
function FilterSelect({ label, value, onChange, options }) {
	const name = intl.formatMessage({ id: label });
	return (
		<AppSelect
			size="sm"
			className="w-auto min-w-[calc(50%-0.25rem)] flex-1 md:min-w-0 md:flex-none"
			aria-label={name}
			value={value}
			onValueChange={onChange}
			options={[{ value: "all", label: `${name}: ${intl.formatMessage({ id: "list.filter.all" })}` }, ...options]}
		/>
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
 * @param {{ id: string, header: *, enableSorting?: boolean }[]} props.sorting.columns the table's columns: either
 *   resolved ones, tableInstance.getAllLeafColumns().map((column) => ({ id: column.id, header: column.columnDef.header,
 *   enableSorting: column.getCanSort() })), or column definitions that all set an explicit id (columnDef.id is
 *   undefined for accessorKey columns); a column is offered unless enableSorting is false or it has no text header
 * @param {{ id: string, desc: boolean }[]} props.sorting.state TanStack SortingState
 * @param {(state: { id: string, desc: boolean }[]) => void} props.sorting.onChange
 */
function ListToolbar({ filters, setFilter, clear, total, shown, kinds, groups = [], sorting }) {
	const active = activeFilterCount(filters, kinds) > 0;
	const [text, setText] = useState(filters.q);
	const inputRef = useRef(null);
	const sortSelectId = useId();

	useEffect(() => {
		// router updates arrive as transitions, so while the box has focus an older q can land after newer
		// keystrokes; only resync on external changes (back navigation) when the user is not typing
		if (document.activeElement === inputRef.current) return;
		setText((current) => (current.trim() === filters.q.trim() ? current : filters.q));
	}, [filters.q]);
	if (!total) return null;
	const sortChoices = sorting ? sortOptions(sorting.columns) : [];
	const sortValue = sortSelectValue(sorting?.state);
	// like the headers, the select always names a column; an empty or unknown sort shows a disabled "Sort by"
	const sortSelected = sortChoices.some((option) => option.id === sortValue.id) ? sortValue.id : "";
	return (
		<div className="flex flex-col gap-2 border-b p-3">
			<div className="flex flex-wrap items-center gap-2">
				<InputGroup className="w-full md:min-w-64 md:flex-1">
					<InputGroupAddon>
						<Search aria-hidden="true" />
					</InputGroupAddon>
					<InputGroupInput
						type="text"
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
				</InputGroup>
				{/* the filters, their count and Clear sit on the right (search on the left) */}
				<div className="flex w-full flex-wrap items-center justify-end gap-2 md:ml-auto md:w-auto">
					{kinds.includes("status") ? (
						<FilterSelect
							label="list.filter.status"
							value={filters.status}
							onChange={(v) => setFilter("status", v)}
							options={STATUS_OPTIONS.map((value) => ({
								value,
								label: intl.formatMessage({ id: `list.filter.${value}` }),
							}))}
						/>
					) : null}
					{kinds.includes("tls") ? (
						<FilterSelect
							label="list.filter.tls"
							value={filters.tls}
							onChange={(v) => setFilter("tls", v)}
							options={TLS_OPTIONS.map((value) => ({
								value,
								label: intl.formatMessage({ id: `list.filter.${value}` }),
							}))}
						/>
					) : null}
					{kinds.includes("group") && groups.length > 0 ? (
						<FilterSelect
							label="list.filter.group"
							value={filters.group ?? "all"}
							onChange={(v) => setFilter("group", v)}
							options={groups.map((value) => ({ value, label: value }))}
						/>
					) : null}
					{kinds.includes("expiry") ? (
						<FilterSelect
							label="list.filter.expiry"
							value={filters.expiry}
							onChange={(v) => setFilter("expiry", v)}
							options={[{ value: "soon", label: intl.formatMessage({ id: "list.filter.soon" }) }]}
						/>
					) : null}
					{active && shown > 0 ? (
						<div className="flex w-full items-center justify-end gap-2 md:w-auto">
							<span className="text-sm text-muted-foreground">
								<T id="list.shown" data={{ shown, total }} />
							</span>
							<Button
								variant="link"
								size="sm"
								className="h-auto p-0"
								onClick={() => {
									setText("");
									clear();
								}}
							>
								<T id="list.clear-filters" />
							</Button>
						</div>
					) : null}
				</div>
			</div>
			{sortChoices.length > 0 ? (
				<div className="flex items-center gap-2 md:hidden">
					<label className="text-sm font-medium" htmlFor={sortSelectId}>
						<T id="list.sort-by" />
					</label>
					<AppSelect
						size="sm"
						className="min-w-0 flex-1"
						id={sortSelectId}
						value={sortSelected}
						placeholder={intl.formatMessage({ id: "list.sort-by" })}
						onValueChange={(id) => sorting.onChange([{ id, desc: sortValue.desc }])}
						options={sortChoices.map((option) => ({ value: option.id, label: option.label }))}
					/>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label={intl.formatMessage({ id: "list.sort-desc" })}
						aria-pressed={sortValue.desc}
						disabled={!sortValue.id}
						onClick={() => sorting.onChange([{ id: sortValue.id, desc: !sortValue.desc }])}
					>
						{sortValue.desc ? (
							<ArrowDownWideNarrow aria-hidden="true" />
						) : (
							<ArrowUpNarrowWide aria-hidden="true" />
						)}
					</Button>
				</div>
			) : null}
		</div>
	);
}

export { ListToolbar };
