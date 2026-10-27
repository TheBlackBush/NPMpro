import { IconAlertTriangle } from "@tabler/icons-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { planRestore } from "src/api/backend";
import { ErrorAlert, ItemChecklist } from "src/components";
import { intl, T } from "src/locale";
import {
	ACTIONS,
	byAction,
	chooseItems,
	linkedItems as linkedOf,
	mergeCatalogue,
	mergeDefaults,
	needsChoice,
	requestItems,
	sentChoices,
} from "src/modules/BackupMerge";
import { withErrorDetails } from "src/modules/BackupTypes";
import { TypeTree } from "src/pages/Settings/Backup/TypeTree";
import { ItemList } from "./ItemList";

// the badge colour of each action
const ACTION_COLORS = {
	add: "bg-green-lt",
	replace: "bg-orange-lt",
	existing: "bg-azure-lt",
	take: "bg-azure-lt",
	skip: "bg-secondary-lt",
	keep: "bg-secondary-lt",
};

const typeLabel = (typeId) => {
	const id = `settings.backup.type.${typeId}`;
	return intl.messages[id] ? intl.formatMessage({ id }) : typeId;
};

// "Proxy hosts: app.example.com"
const itemText = (item) =>
	intl.formatMessage({ id: "settings.backup.merge.item" }, { type: typeLabel(item.type), label: item.label });

// the name of a plan item by its key (with its type when full), the key itself when the plan does not hold it
const labelsOf = (plan, full = false) => {
	const byKey = new Map((plan?.items ?? []).map((item) => [item.key, item]));
	return (key) => {
		const item = byKey.get(key);
		if (!item) return key;
		return full ? itemText(item) : item.label;
	};
};

/**
 * The notes of a merge plan or result: links that are cleared because their target is not restored, and items that
 * are restored without their secrets.
 */
export function MergeNotes({ plan, cleared = [], needsSecrets = [] }) {
	const labelOf = labelsOf(plan, true);
	return (
		<>
			<ItemList
				titleId="settings.backup.merge.cleared-links"
				items={cleared.map((link, index) => ({
					key: `${link.key}-${link.column}-${link.from}-${index}`,
					text: intl.formatMessage(
						{ id: "settings.backup.merge.cleared-link" },
						{ item: labelOf(link.key), target: link.label },
					),
				}))}
			/>
			<ItemList
				titleId="settings.backup.merge.needs-secrets"
				items={needsSecrets.map((key) => ({ key, text: labelOf(key) }))}
			/>
		</>
	);
}

/**
 * The state of a merge: the chosen items and choices, and the plan (dry run) of them, asked again 300 ms after the
 * last change of the types, items or choices. request is the request the shown plan belongs to; the merge sends it
 * with the plan's hash.
 *
 * @param {Object}   options
 * @param {string}   [options.token]   the opened backup
 * @param {string[]} options.types     the selected types
 * @param {boolean}  options.enabled   merge is the chosen mode
 */
export function useMergePlan({ token, types, enabled }) {
	const [items, setItems] = useState({});
	const [choices, setChoices] = useState({});
	const [plan, setPlan] = useState(null);
	const [catalogue, setCatalogue] = useState({});
	const [checking, setChecking] = useState(false);
	const [error, setError] = useState(null);
	const [changed, setChanged] = useState(false);
	const [request, setRequest] = useState(null);
	// the state the shown plan belongs to
	const checkedRef = useRef(null);
	// the default choice of every item seen in a plan
	const defaultsRef = useRef({});
	const state = useMemo(() => ({ types, items, choices }), [types, items, choices]);

	useEffect(() => {
		if (!(enabled && token) || state === checkedRef.current) return;
		if (types.length === 0) {
			setChecking(false);
			return;
		}
		let current = true;
		setChecking(true);
		const timer = setTimeout(async () => {
			const sent = {
				types,
				items: requestItems(items, types),
				// every local choice that differs from its item's default, also of items the plan left out for now
				choices: sentChoices(choices, defaultsRef.current),
			};
			try {
				const next = await planRestore(token, sent);
				if (!current) return;
				checkedRef.current = state;
				defaultsRef.current = mergeDefaults(defaultsRef.current, next);
				setPlan(next);
				setRequest(sent);
				setCatalogue((known) => mergeCatalogue(known, next));
				setChanged(false);
				setError(null);
			} catch (err) {
				if (current) setError(withErrorDetails(err));
			} finally {
				if (current) setChecking(false);
			}
		}, 300);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [enabled, token, state, types, items, choices]);

	return {
		items,
		setItems,
		choices,
		setChoice: (key, choice) => setChoices((prev) => ({ ...prev, [key]: choice })),
		plan,
		catalogue,
		request,
		error,
		changed,
		stale: checking || state !== checkedRef.current,
		// the plan a merge answered with when the instance changed since this one: shown for a new confirmation
		planChanged: (next) => {
			defaultsRef.current = mergeDefaults(defaultsRef.current, next);
			setPlan(next);
			setCatalogue((known) => mergeCatalogue(known, next));
			setChanged(true);
		},
	};
}

// why the item meets an instance row, with the row
function Reason({ item }) {
	if (!item.reason) return null;
	return (
		<T
			id={`settings.backup.merge.reason.${item.reason}`}
			data={{ target: item.target?.label ?? "", id: item.target?.id ?? "" }}
		/>
	);
}

// one item of the plan: its name, what it meets, what needs it, its choice and, for a linked item, the untick box
function ItemRow({ item, choice, onChoice, labelOf, disabled }) {
	const description = [
		<span key="type">{typeLabel(item.type)}</span>,
		item.reason ? <Reason key="reason" item={item} /> : null,
		item.neededBy?.length ? (
			<T
				key="needed"
				id="settings.backup.merge.needed-by"
				data={{ names: item.neededBy.map(labelOf).join(", ") }}
			/>
		) : null,
	].filter(Boolean);
	const value = item.choices.includes(choice) ? choice : item.action;
	return (
		<div className="list-group-item d-block d-sm-flex">
			<div className="list-group-item-content">
				<div className="list-group-item-title text-wrap text-break">{item.label}</div>
				<div className="list-group-item-description text-wrap text-break small">
					{description.map((part, index) => (
						<span key={part.key}>
							{index > 0 ? " · " : null}
							{part}
						</span>
					))}
				</div>
			</div>
			<div className="list-group-item-actions d-flex flex-wrap align-items-center gap-3 mt-2 mt-sm-0">
				{item.linked ? (
					<label className="form-check mb-0">
						<input
							className="form-check-input"
							type="checkbox"
							checked={choice === undefined ? !item.unticked : choice !== "unticked"}
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
				{item.choices.length > 1 && !item.unticked ? (
					<select
						className="form-select form-select-sm w-auto"
						value={value}
						onChange={(e) => onChoice(item.key, e.target.value)}
						disabled={disabled}
						aria-label={intl.formatMessage(
							{ id: "settings.backup.merge.choice-for" },
							{ label: item.label },
						)}
					>
						{item.choices.map((option) => (
							<option key={option} value={option}>
								{intl.formatMessage({ id: `settings.backup.merge.choice.${option}` })}
							</option>
						))}
					</select>
				) : (
					<span className={`badge ${ACTION_COLORS[item.action] ?? "bg-secondary-lt"}`}>
						<T id={`settings.backup.merge.action.${item.action}`} />
					</span>
				)}
			</div>
		</div>
	);
}

// capped: a long list scrolls instead of stretching the dialog (no Tabler utility caps a height, only mh-100)
function ItemRows({ items, merge, labelOf, disabled, capped = false }) {
	return (
		<div
			className={capped ? "list-group overflow-auto" : "list-group"}
			style={capped ? { maxHeight: "20rem" } : undefined}
		>
			{items.map((item) => (
				<ItemRow
					key={item.key}
					item={item}
					choice={merge.choices[item.key]}
					onChoice={merge.setChoice}
					labelOf={labelOf}
					disabled={disabled}
				/>
			))}
		</div>
	);
}

/**
 * Merge, what to restore and what it changes: the type boxes with "Choose items" per type, the counts per action, the
 * items that need a choice, all changes grouped by action on request, and the links cleared and secrets missing.
 *
 * @param {Object}    props
 * @param {Object}    props.merge          useMergePlan()
 * @param {Array}     props.categories     the file's categories
 * @param {Object}    props.counts         type id -> rows or files in the file
 * @param {string[]}  props.selected       the selected types
 * @param {Function}  props.onTypesChange  (types) => void
 * @param {Function}  props.onEdit         called on every change of items or choices
 * @param {boolean}   [props.disabled]
 * @param {string}    [props.partsLabelId]  the label of the type boxes
 */
export function MergeView({
	merge,
	categories,
	counts,
	selected,
	onTypesChange,
	onEdit,
	disabled = false,
	partsLabelId = "settings.backup.restore.parts",
}) {
	const baseId = useId();
	const [openType, setOpenType] = useState(null);
	const [showAll, setShowAll] = useState(false);
	const { plan, catalogue, items } = merge;
	const labelOf = labelsOf(plan);

	const itemCounts = {};
	for (const [typeId, list] of Object.entries(catalogue)) {
		if (list.length > 0)
			itemCounts[typeId] = { selected: items[typeId]?.length ?? list.length, total: list.length };
	}
	const open = openType && selected.includes(openType) && catalogue[openType] ? openType : null;
	const panel = open ? (
		<div className="card card-sm">
			<div className="card-header py-2">
				<div id={`${baseId}-items-title`} className="card-title">
					<T id={`settings.backup.type.${open}`} />
				</div>
			</div>
			<ItemChecklist
				labelledBy={`${baseId}-items-title`}
				items={catalogue[open]}
				selected={items[open] ?? catalogue[open].map((item) => item.id)}
				onChange={(ids) => {
					merge.setItems(chooseItems(items, open, ids, catalogue[open].length));
					onEdit();
				}}
				disabled={disabled}
			/>
		</div>
	) : null;

	const choose = (key, choice) => {
		merge.setChoice(key, choice);
		onEdit();
	};
	const rowProps = { merge: { ...merge, setChoice: choose }, labelOf, disabled };
	// clashes and matches with a choice
	const choiceItems = plan ? needsChoice(plan) : [];
	// the linked items, with Include and their choice, listed after the choices
	const linkedItems = plan ? linkedOf(plan) : [];
	const groups = plan ? byAction(plan) : {};
	const allId = `${baseId}-all`;

	return (
		<>
			<TypeTree
				label={<T id={partsLabelId} />}
				categories={categories}
				counts={counts}
				selected={selected}
				onChange={onTypesChange}
				disabled={disabled}
				itemCounts={itemCounts}
				onChooseItems={(typeId) => setOpenType((current) => (current === typeId ? null : typeId))}
				openType={open}
				itemsPanel={panel}
			/>
			<ErrorAlert error={merge.error} />
			{merge.changed ? (
				<div className="alert alert-warning" role="alert">
					<div className="alert-icon">
						<IconAlertTriangle className="icon" aria-hidden="true" />
					</div>
					<div>
						<T id="settings.backup.merge.plan-changed" />
					</div>
				</div>
			) : null}
			{plan && selected.length > 0 ? (
				<>
					<div className="mb-3">
						<div className="form-label">
							<T id="settings.backup.merge.changes" />
						</div>
						<div className="badge-list">
							{ACTIONS.filter((action) => plan.counts[action] > 0).map((action) => (
								<span key={action} className={`badge ${ACTION_COLORS[action]}`}>
									<T id={`settings.backup.merge.action.${action}`} />
									<span className="ms-1">{plan.counts[action]}</span>
								</span>
							))}
						</div>
					</div>
					{choiceItems.length > 0 ? (
						<div className="mb-3">
							<div className="fw-bold mb-1">
								<T id="settings.backup.merge.needs-choice" data={{ count: choiceItems.length }} />
							</div>
							<ItemRows items={choiceItems} {...rowProps} />
						</div>
					) : null}
					{linkedItems.length > 0 ? (
						<div className="mb-3">
							<div className="fw-bold mb-1">
								<T id="settings.backup.merge.linked" />
							</div>
							<ItemRows items={linkedItems} {...rowProps} />
						</div>
					) : null}
					{plan.items.length > 0 ? (
						<button
							type="button"
							className="btn btn-link p-0 mb-3"
							aria-expanded={showAll}
							aria-controls={allId}
							onClick={() => setShowAll((value) => !value)}
						>
							<T id="settings.backup.merge.show-all" />
						</button>
					) : null}
					<div id={allId} hidden={!showAll}>
						{showAll
							? Object.entries(groups).map(([action, list]) => (
									<div key={action} className="mb-3">
										<div className="mb-1">
											<span className={`badge ${ACTION_COLORS[action]}`}>
												<T id={`settings.backup.merge.action.${action}`} />
												<span className="ms-1">{list.length}</span>
											</span>
										</div>
										<ItemRows items={list} {...rowProps} capped />
									</div>
								))
							: null}
					</div>
					<MergeNotes plan={plan} cleared={plan.clearedLinks} needsSecrets={plan.needsSecrets} />
				</>
			) : null}
		</>
	);
}

/**
 * Replace or Merge, as a segmented radio group; Replace is disabled for a file of single items (partial).
 *
 * @param {Object}   props
 * @param {string}   props.mode      "replace" or "merge"
 * @param {boolean}  props.partial
 * @param {Function} props.onChange  (mode) => void
 */
export function ModeSwitch({ mode, partial, onChange }) {
	const baseId = useId();
	const hintId = `${baseId}-hint`;
	const option = (value, labelId, disabled = false) => (
		<>
			<input
				type="radio"
				className="btn-check"
				name={`${baseId}-mode`}
				id={`${baseId}-${value}`}
				autoComplete="off"
				checked={mode === value}
				onChange={() => onChange(value)}
				disabled={disabled}
				aria-describedby={disabled ? hintId : undefined}
			/>
			<label className="btn" htmlFor={`${baseId}-${value}`}>
				<T id={labelId} />
			</label>
		</>
	);
	return (
		<div className="mb-3">
			<div
				className="btn-group"
				role="radiogroup"
				aria-label={intl.formatMessage({ id: "settings.backup.mode" })}
			>
				{option("replace", "settings.backup.mode.replace", partial)}
				{option("merge", "settings.backup.mode.merge")}
			</div>
			{partial ? (
				<div id={hintId} className="form-hint mt-1">
					<T id="settings.backup.mode.partial-only" />
				</div>
			) : null}
		</div>
	);
}
