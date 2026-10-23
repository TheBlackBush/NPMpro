import { IconSearch } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { intl, T } from "src/locale";
import { activeFilterCount } from "src/modules/ListFilters";

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
 */
function ListToolbar({ filters, setFilter, clear, total, shown, kinds, groups = [] }) {
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
						{" "}
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
						{" "}
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
						{" "}
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
						{" "}
						<FilterSelect
							label="list.filter.expiry"
							value={filters.expiry}
							onChange={(v) => setFilter("expiry", v)}
							options={[{ value: "soon", label: intl.formatMessage({ id: "list.filter.soon" }) }]}
						/>
					</div>
				) : null}
				{active ? (
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
		</div>
	);
}

export { ListToolbar };
