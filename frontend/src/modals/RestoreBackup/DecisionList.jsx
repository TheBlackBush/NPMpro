import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { BreakableHost } from "src/components";
import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Checkbox } from "src/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "src/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "src/components/ui/input-group";
import { cn } from "src/lib/utils";
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

// the badge look of each action, by tokens (an outline badge tinted by the token, or the secondary look)
const TINT = {
	success: "bg-success/10 border-success/40 text-foreground",
	warning: "bg-warning/10 border-warning/40 text-foreground",
};
const ACTION_LOOKS = {
	add: { variant: "outline", className: TINT.success },
	replace: { variant: "outline", className: TINT.warning },
	existing: { variant: "secondary" },
	take: { variant: "secondary" },
	skip: { variant: "outline" },
	keep: { variant: "outline" },
};

// the badge look of each reason an item meets an instance row
const REASON_LOOKS = {
	"domain-in-use": { variant: "outline", className: TINT.warning },
	"domain-in-use-several": { variant: "outline", className: TINT.warning },
	"port-in-use": { variant: "outline", className: TINT.warning },
	"same-certificate": { variant: "secondary" },
	"same-name": { variant: "secondary" },
	"same-email": { variant: "secondary" },
	differs: { variant: "outline" },
};

// the badge of an action ("Add", "Replace" and so on); children follow the name (a count)
export function ActionBadge({ action, children }) {
	const look = ACTION_LOOKS[action] ?? { variant: "secondary" };
	return (
		<Badge variant={look.variant} className={look.className}>
			<T id={`settings.backup.merge.action.${action}`} />
			{children}
		</Badge>
	);
}

// the pressed look of a choice or filter button: not the primary colour, a ring and a check mark instead
const PRESSED = "ring-1 ring-primary/50";

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
function ReasonBadge({ reason, className }) {
	const look = REASON_LOOKS[reason] ?? { variant: "secondary" };
	return (
		<Badge variant={look.variant} className={cn("h-auto whitespace-normal", look.className, className)}>
			<T id={`settings.backup.merge.badge.${reason}`} />
		</Badge>
	);
}

/**
 * One item: its name (and what needs it), what it meets here, and Include and its choices as a segmented group.
 * On phones the row is a stacked block: the item cell also shows the reason badge and, as the grey summary line, what
 * the item meets here, while the Found cell is hidden; the Action cell stays and stacks as a full-width line under
 * the item, so Include and the choices are rendered once (no control or accessible name exists twice).
 */
function DecisionRow({ item, choice, onChoice, labelOf, disabled }) {
	const included = isIncluded(item, choice);
	const value = currentChoice(item, choice);
	const target = targetText(item);
	return (
		<tr data-key={item.key} className="block border-t md:table-row">
			<td className="block px-3 py-2 align-middle md:table-cell">
				<div className={titleClass()}>
					<BreakableHost value={item.label} />
				</div>
				{item.neededBy?.length ? (
					<div className="text-sm break-words text-muted-foreground">
						<T
							id="settings.backup.merge.needed-by"
							data={{ names: item.neededBy.map(labelOf).join(", ") }}
						/>
					</div>
				) : null}
				{item.reason || target ? (
					<div className="md:hidden">
						{item.reason ? (
							<div className="mt-1">
								<ReasonBadge reason={item.reason} />
							</div>
						) : null}
						{target ? (
							<div className="mt-1 text-sm break-words text-muted-foreground">
								<BreakableHost value={target} />
							</div>
						) : null}
					</div>
				) : null}
			</td>
			<td className={cn(PHONE_HIDDEN_CELL, "px-3 py-2 align-middle")}>
				{item.reason ? <ReasonBadge reason={item.reason} className="mr-1" /> : null}
				{target ? (
					<span className="text-sm break-words text-muted-foreground">
						<BreakableHost value={target} />
					</span>
				) : null}
			</td>
			<td className="block px-3 py-2 align-middle md:table-cell md:w-px md:whitespace-nowrap">
				{/* on phones the line wraps, so the choice group takes its own full-width line when Include does not fit */}
				<div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
					{item.linked ? (
						// biome-ignore lint/a11y/noLabelWithoutControl: the Radix checkbox inside is a button, which labels the row
						<label className="flex cursor-pointer items-center gap-2 text-sm has-[:disabled]:cursor-not-allowed">
							<Checkbox
								checked={included}
								onCheckedChange={(on) => onChoice(item.key, on === true ? item.default : "unticked")}
								disabled={disabled}
								aria-label={intl.formatMessage(
									{ id: "settings.backup.merge.include-item" },
									{ label: item.label },
								)}
							/>
							<span aria-hidden="true">
								<T id="settings.backup.merge.include" />
							</span>
						</label>
					) : null}
					{item.choices.length > 0 ? (
						// on phones the group fills the line, its buttons share the width
						<fieldset
							className="m-0 flex min-w-0 flex-1 gap-1 border-0 p-0 md:flex-none"
							aria-label={intl.formatMessage(
								{ id: "settings.backup.merge.choice-for" },
								{ label: item.label },
							)}
						>
							{item.choices.map((option) => (
								<Button
									key={option}
									type="button"
									size="sm"
									variant={value === option ? "secondary" : "outline"}
									className={cn("flex-1", value === option && PRESSED)}
									aria-pressed={value === option}
									onClick={() => onChoice(item.key, option)}
									disabled={disabled || !included || item.choices.length === 1}
								>
									{value === option ? <CheckIcon aria-hidden="true" /> : null}
									{optionLabel(option)}
								</Button>
							))}
						</fieldset>
					) : (
						<ActionBadge action={item.action} />
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
		<tr className="block bg-muted/50 md:table-row">
			<th scope="rowgroup" colSpan={3} className="block px-3 py-2 text-left font-normal md:table-cell">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-expanded={open}
						aria-label={name}
						onClick={onFold}
					>
						{open ? <ChevronUpIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
					</Button>
					<span className="text-sm font-bold text-muted-foreground uppercase">{name}</span>
					<Badge variant="secondary">{group.items.length}</Badge>
					<span className="hidden text-sm text-muted-foreground sm:inline">{summary}</span>
					{options.length > 1 ? (
						// below sm "Set all" takes its own line
						<div className="w-full sm:hidden" />
					) : null}
					{options.length > 1 ? (
						<div className="flex items-center sm:ml-auto">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={disabled}
										aria-label={intl.formatMessage(
											{ id: "settings.backup.merge.set-all-for" },
											{ type: inSentence(name, intl.locale) },
										)}
									>
										<span aria-hidden="true">
											<T id="settings.backup.merge.set-all" />
										</span>
										<ChevronDownIcon aria-hidden="true" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" collisionPadding={8} className="w-auto">
									{options.map((option) => (
										<DropdownMenuItem key={option} onSelect={() => onSetAll(option)}>
											{optionLabel(option)}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
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
		<Button
			key={value ?? "all"}
			type="button"
			size="sm"
			variant={activeReason === value ? "secondary" : "outline"}
			className={cn("rounded-full", activeReason === value && PRESSED)}
			aria-pressed={activeReason === value}
			onClick={() => setReason(value)}
		>
			{activeReason === value ? <CheckIcon aria-hidden="true" /> : null}
			{children}
		</Button>
	);

	return (
		<div className="mb-3">
			<div className="flex items-baseline gap-2">
				<h4 id={titleId} className="m-0 text-base font-medium">
					<T id="settings.backup.merge.decisions" />
				</h4>
				<Badge variant="secondary">{items.length}</Badge>
			</div>
			<p className="mb-2 text-sm text-muted-foreground">
				<T id="settings.backup.merge.decisions-hint" />
			</p>
			{tools ? (
				<div className="mb-2 flex flex-wrap items-center gap-2">
					{/* the search keeps 12rem before the chips wrap */}
					<InputGroup className="h-8 min-w-48 flex-1">
						<InputGroupAddon>
							<SearchIcon aria-hidden="true" />
						</InputGroupAddon>
						<InputGroupInput
							type="search"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder={searchLabel}
							aria-label={searchLabel}
						/>
					</InputGroup>
					<fieldset
						className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0"
						aria-label={intl.formatMessage({ id: "settings.backup.merge.filter" })}
					>
						{chip(null, <T id="list.filter.all" />)}
						{reasons.map((value) => chip(value, <T id={`settings.backup.merge.badge.${value}`} />))}
					</fieldset>
				</div>
			) : null}
			<div className="overflow-hidden rounded-lg border">
				<table ref={tableRef} className="block w-full text-sm md:table" aria-labelledby={titleId}>
					<thead className="hidden md:table-header-group">
						<tr className="border-b">
							{/* the item gets at least half the width, so its name does not break mid-label on tablets */}
							<th scope="col" className="w-1/2 px-3 py-2 text-left font-medium text-muted-foreground">
								<T id="settings.backup.merge.column.item" />
							</th>
							<th scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
								<T id="settings.backup.merge.column.found" />
							</th>
							<th scope="col" className="w-px px-3 py-2 text-left font-medium text-muted-foreground">
								<T id="settings.backup.merge.column.action" />
							</th>
						</tr>
					</thead>
					{groups.map((group) => {
						const open = !folded.includes(group.type);
						return (
							<tbody
								key={group.type}
								className="block border-t first-of-type:border-t-0 md:table-row-group"
							>
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
									<tr className="block border-t md:table-row">
										<td colSpan={3} className="block px-3 py-2 text-center md:table-cell">
											<Button
												type="button"
												variant="link"
												size="sm"
												className="h-auto p-0"
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
														one: inSentence(typeName(group.type, group.more), intl.locale),
														type: inSentence(typeName(group.type), intl.locale),
													}}
												/>
											</Button>
										</td>
									</tr>
								) : null}
							</tbody>
						);
					})}
					{groups.length === 0 ? (
						<tbody className="block md:table-row-group">
							<tr className="block md:table-row">
								<td
									colSpan={3}
									className="block px-3 py-3 text-center text-muted-foreground md:table-cell"
								>
									<T id="list.no-match" />
								</td>
							</tr>
						</tbody>
					) : null}
				</table>
			</div>
			<div className="mt-2 text-sm text-muted-foreground">
				<T id="settings.backup.merge.summary" data={{ shown: shown.length, total: items.length, changed }} />
			</div>
		</div>
	);
}
