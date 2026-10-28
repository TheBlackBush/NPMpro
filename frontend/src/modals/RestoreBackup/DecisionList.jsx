import { IconChevronDown, IconChevronUp, IconSearch } from "@tabler/icons-react";
import cn from "clsx";
import { useEffect, useId, useRef, useState } from "react";
import { intl, T } from "src/locale";
import {
	changedChoices,
	choiceSummary,
	currentChoice,
	decisionReasons,
	filterDecisions,
	groupChoices,
	groupDecisions,
	inSentence,
	isIncluded,
	setAllChoices,
	typeNameId,
} from "src/modules/BackupMerge";
import { PHONE_HIDDEN_CELL, titleClass } from "src/modules/MobileColumns";

// the badge colour of each action
export const ACTION_COLORS = {
	add: "bg-green-lt",
	replace: "bg-orange-lt",
	existing: "bg-azure-lt",
	take: "bg-azure-lt",
	skip: "bg-secondary-lt",
	keep: "bg-secondary-lt",
};

// the badge colour of each reason an item meets an instance row
const REASON_COLORS = {
	"domain-in-use": "bg-orange-lt",
	"domain-in-use-several": "bg-orange-lt",
	"port-in-use": "bg-orange-lt",
	"same-certificate": "bg-azure-lt",
	"same-name": "bg-purple-lt",
	"same-email": "bg-teal-lt",
	differs: "bg-yellow-lt",
};

// search and the reason filters are shown from this many items
const TOOLS_FROM = 11;

// the type's name, singular for a count of one when it has a singular name
const typeName = (typeId, count) => {
	const id = typeNameId(typeId, count, intl.messages);
	return id ? intl.formatMessage({ id }) : typeId;
};

const optionLabel = (choice) => intl.formatMessage({ id: `settings.backup.merge.option.${choice}` });

// the instance row an item meets: "#3 app.example.com" for a certificate, nothing for a setting or file that differs
const targetText = (item) => {
	if (!item.target || item.reason === "differs") return "";
	return item.reason === "same-certificate" ? `#${item.target.id} ${item.target.label}` : item.target.label;
};

// the reason badge of an item
function ReasonBadge({ reason, className = "" }) {
	return (
		<span className={cn("badge", REASON_COLORS[reason] ?? "bg-secondary-lt", className)}>
			<T id={`settings.backup.merge.badge.${reason}`} />
		</span>
	);
}

/**
 * One item: its name (and what needs it), what it meets here, and Include and its choices as a segmented group.
 * On phones (table-mobile-md) the item cell also shows the reason badge and, as the grey summary line, what the item
 * meets here, while the Found cell is hidden; the Action cell stays and stacks as a full-width line under the item,
 * so Include and the choices are rendered once (no control or accessible name exists twice).
 */
function DecisionRow({ item, choice, onChoice, labelOf, disabled }) {
	const included = isIncluded(item, choice);
	const value = currentChoice(item, choice);
	const target = targetText(item);
	return (
		<tr data-key={item.key}>
			<td>
				<div className={titleClass()}>{item.label}</div>
				{item.neededBy?.length ? (
					<div className="small text-secondary text-break">
						<T
							id="settings.backup.merge.needed-by"
							data={{ names: item.neededBy.map(labelOf).join(", ") }}
						/>
					</div>
				) : null}
				{item.reason || target ? (
					<div className="d-md-none">
						{item.reason ? (
							<div className="mt-1">
								<ReasonBadge reason={item.reason} />
							</div>
						) : null}
						{target ? <div className="mt-1 small text-secondary text-break">{target}</div> : null}
					</div>
				) : null}
			</td>
			<td className={PHONE_HIDDEN_CELL}>
				{item.reason ? <ReasonBadge reason={item.reason} className="me-1" /> : null}
				{target ? <span className="text-secondary small text-break">{target}</span> : null}
			</td>
			<td>
				{/* on phones the line wraps, so the choice group takes its own full-width line when Include does not fit */}
				<div className="d-flex flex-wrap flex-md-nowrap align-items-center gap-3 text-nowrap">
					{item.linked ? (
						<label className="form-check mb-0">
							<input
								className="form-check-input"
								type="checkbox"
								checked={included}
								onChange={(e) => onChoice(item.key, e.target.checked ? item.default : "unticked")}
								disabled={disabled}
								aria-label={intl.formatMessage(
									{ id: "settings.backup.merge.include-item" },
									{ label: item.label },
								)}
							/>
							<span className="form-check-label" aria-hidden="true">
								<T id="settings.backup.merge.include" />
							</span>
						</label>
					) : null}
					{item.choices.length > 0 ? (
						// on phones the group fills the line, its buttons share the width
						<fieldset
							className="btn-group btn-group-sm flex-fill flex-md-grow-0"
							aria-label={intl.formatMessage(
								{ id: "settings.backup.merge.choice-for" },
								{ label: item.label },
							)}
						>
							{item.choices.map((option) => (
								<button
									key={option}
									type="button"
									className={cn("btn flex-fill", value === option && "btn-primary")}
									aria-pressed={value === option}
									onClick={() => onChoice(item.key, option)}
									disabled={disabled || !included || item.choices.length === 1}
								>
									{optionLabel(option)}
								</button>
							))}
						</fieldset>
					) : (
						<span className={`badge ${ACTION_COLORS[item.action] ?? "bg-secondary-lt"}`}>
							<T id={`settings.backup.merge.action.${item.action}`} />
						</span>
					)}
				</div>
			</td>
		</tr>
	);
}

// the header row of a type's group: fold, name, count, the current choices and "Set all"
function GroupHeader({ group, choices, open, onFold, onSetAll, disabled }) {
	const name = typeName(group.type);
	const summary = choiceSummary(group.items, choices)
		.map(({ choice, count }) =>
			intl.formatMessage(
				{ id: "settings.backup.merge.choice-count" },
				{ count, choice: inSentence(optionLabel(choice), intl.locale) },
			),
		)
		.join(", ");
	const options = groupChoices(group.items);
	return (
		<tr>
			<th scope="rowgroup" colSpan={3} className="py-2 bg-secondary-lt fw-normal">
				<div className="d-flex flex-wrap align-items-center gap-2">
					<button
						type="button"
						// d-inline-flex: table-mobile-md makes every .btn a block on phones
						className="btn btn-sm btn-ghost-secondary btn-icon d-inline-flex"
						aria-expanded={open}
						aria-label={name}
						onClick={onFold}
					>
						{open ? (
							<IconChevronUp className="icon" aria-hidden="true" />
						) : (
							<IconChevronDown className="icon" aria-hidden="true" />
						)}
					</button>
					<span className="small fw-bold text-uppercase text-secondary">{name}</span>
					<span className="badge bg-secondary-lt">{group.items.length}</span>
					<span className="small text-secondary d-none d-sm-inline">{summary}</span>
					{options.length > 1 ? (
						// below sm "Set all" takes its own line
						<div className="w-100 d-sm-none" />
					) : null}
					{options.length > 1 ? (
						<div className="d-flex align-items-center gap-2 ms-sm-auto">
							<span className="small text-secondary" aria-hidden="true">
								<T id="settings.backup.merge.set-all" />
							</span>
							<fieldset
								className="btn-group btn-group-sm"
								aria-label={intl.formatMessage(
									{ id: "settings.backup.merge.set-all-for" },
									{ type: inSentence(name, intl.locale) },
								)}
							>
								{options.map((option) => (
									<button
										key={option}
										type="button"
										className="btn"
										onClick={() => onSetAll(option)}
										disabled={disabled}
									>
										{optionLabel(option)}
									</button>
								))}
							</fieldset>
						</div>
					) : null}
				</div>
			</th>
		</tr>
	);
}

/**
 * "Already on this instance": the items that match or clash with an instance row and the linked items, as a table
 * grouped by type with a segmented choice per item. From 11 items a search and filters per reason; a group shows 8
 * rows, then "Show more", folds, and sets the choice of all its shown items at once.
 *
 * @param {Object}   props
 * @param {Array}    props.items     decisionItems(plan)
 * @param {Object}   props.choices   the local choices, { [key]: choice }
 * @param {Function} props.onChoice  (key, choice) => void
 * @param {Function} props.labelOf   key => label, for "Needed by"
 * @param {boolean}  [props.disabled]
 */
export function DecisionList({ items, choices, onChoice, labelOf, disabled = false }) {
	const baseId = useId();
	const titleId = `${baseId}-title`;
	const [search, setSearch] = useState("");
	const [reason, setReason] = useState(null);
	const [folded, setFolded] = useState([]);
	const [expanded, setExpanded] = useState([]);
	// the row to focus after "Show more" removed its button
	const [focusKey, setFocusKey] = useState(null);
	const tableRef = useRef(null);
	useEffect(() => {
		if (!focusKey) return;
		const row = [...(tableRef.current?.querySelectorAll("tr[data-key]") ?? [])].find(
			(element) => element.dataset.key === focusKey,
		);
		const control = row?.querySelector("input:not(:disabled), button:not(:disabled)");
		if (control) control.focus();
		else if (row) {
			// a row whose choice is fixed has no control: the row itself takes the focus
			row.tabIndex = -1;
			row.focus();
		}
		setFocusKey(null);
	}, [focusKey]);
	const tools = items.length >= TOOLS_FROM;
	const reasons = decisionReasons(items);
	const activeReason = tools && reasons.includes(reason) ? reason : null;
	const shown = tools ? filterDecisions(items, { search, reason: activeReason }) : items;
	const groups = groupDecisions(shown, { expanded, searching: tools && search.trim() !== "" });
	const changed = Object.keys(changedChoices({ items }, choices)).length;
	const toggle = (list, type) => (list.includes(type) ? list.filter((other) => other !== type) : [...list, type]);
	const searchLabel = intl.formatMessage({ id: "settings.backup.merge.search" });

	const chip = (value, children) => (
		<button
			key={value ?? "all"}
			type="button"
			className={cn("btn btn-sm btn-pill", activeReason === value && "btn-primary")}
			aria-pressed={activeReason === value}
			onClick={() => setReason(value)}
		>
			{children}
		</button>
	);

	return (
		<div className="mb-3">
			<div className="d-flex align-items-baseline gap-2">
				<h4 id={titleId} className="m-0">
					<T id="settings.backup.merge.decisions" />
				</h4>
				<span className="badge bg-secondary-lt">{items.length}</span>
			</div>
			<p className="text-secondary small mb-2">
				<T id="settings.backup.merge.decisions-hint" />
			</p>
			{tools ? (
				<div className="d-flex flex-wrap align-items-center gap-2 mb-2">
					{/* no Tabler utility sets a minimum width: the search keeps 12rem before the chips wrap */}
					<div className="input-icon flex-fill" style={{ minWidth: "12rem" }}>
						<span className="input-icon-addon">
							<IconSearch className="icon" aria-hidden="true" />
						</span>
						<input
							type="search"
							className="form-control form-control-sm"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder={searchLabel}
							aria-label={searchLabel}
						/>
					</div>
					<fieldset
						className="d-flex flex-wrap gap-1"
						aria-label={intl.formatMessage({ id: "settings.backup.merge.filter" })}
					>
						{chip(null, <T id="list.filter.all" />)}
						{reasons.map((value) => chip(value, <T id={`settings.backup.merge.badge.${value}`} />))}
					</fieldset>
				</div>
			) : null}
			<div className="card">
				<div className="table-responsive">
					<table
						ref={tableRef}
						className="table table-vcenter table-mobile-md card-table"
						aria-labelledby={titleId}
					>
						<thead>
							<tr>
								<th scope="col">
									<T id="settings.backup.merge.column.item" />
								</th>
								<th scope="col">
									<T id="settings.backup.merge.column.found" />
								</th>
								<th scope="col" className="w-1">
									<T id="settings.backup.merge.column.action" />
								</th>
							</tr>
						</thead>
						{groups.map((group) => {
							const open = !folded.includes(group.type);
							return (
								<tbody key={group.type}>
									<GroupHeader
										group={group}
										choices={choices}
										open={open}
										onFold={() => setFolded((list) => toggle(list, group.type))}
										onSetAll={(option) => {
											for (const [key, choice] of Object.entries(
												setAllChoices(group.items, option, choices),
											)) {
												onChoice(key, choice);
											}
										}}
										disabled={disabled}
									/>
									{open
										? group.rows.map((item) => (
												<DecisionRow
													key={item.key}
													item={item}
													choice={choices[item.key]}
													onChoice={onChoice}
													labelOf={labelOf}
													disabled={disabled}
												/>
											))
										: null}
									{open && group.more > 0 ? (
										<tr>
											<td colSpan={3} className="text-center py-2">
												<button
													type="button"
													className="btn btn-link btn-sm p-0 d-inline-flex"
													onClick={() => {
														setExpanded((list) => [...list, group.type]);
														// the button goes away: focus moves to the first row it showed
														setFocusKey(group.items[group.rows.length].key);
													}}
												>
													<T
														id="settings.backup.merge.show-more"
														data={{
															count: group.more,
															one: inSentence(
																typeName(group.type, group.more),
																intl.locale,
															),
															type: inSentence(typeName(group.type), intl.locale),
														}}
													/>
												</button>
											</td>
										</tr>
									) : null}
								</tbody>
							);
						})}
						{groups.length === 0 ? (
							<tbody>
								<tr>
									<td colSpan={3} className="text-secondary text-center py-3">
										<T id="list.no-match" />
									</td>
								</tr>
							</tbody>
						) : null}
					</table>
				</div>
			</div>
			<div className="small text-secondary mt-2">
				<T id="settings.backup.merge.summary" data={{ shown: shown.length, total: items.length, changed }} />
			</div>
		</div>
	);
}
