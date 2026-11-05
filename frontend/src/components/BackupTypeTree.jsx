import {
	FileCodeIcon,
	KeyRoundIcon,
	ListChecksIcon,
	LockIcon,
	ServerIcon,
	SettingsIcon,
	ShieldCheckIcon,
	UsersIcon,
} from "lucide-react";
import { useId } from "react";
import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Checkbox } from "src/components/ui/checkbox";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { inSentence } from "src/modules/BackupMerge";
import { arrangeRows, categoryState, toggleCategory, toggleType } from "src/modules/BackupTypes";

// certificate providers in the order shown, with their label
const CERTIFICATE_KINDS = [
	["letsencrypt", "settings.backup.kind.letsencrypt"],
	["other", "settings.backup.kind.other"],
	["mtls", "settings.backup.kind.mtls"],
];

const CATEGORY_ICONS = {
	hosts: ServerIcon,
	certificates: ShieldCheckIcon,
	access_lists: LockIcon,
	dns_credentials: KeyRoundIcon,
	users: UsersIcon,
	settings: SettingsIcon,
	custom_files: FileCodeIcon,
};

// the rows or files of a category: the sum of its types
const categoryCount = (category, counts) => {
	const values = category.types.map((typeId) => counts[typeId]).filter((value) => value !== undefined);
	return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : undefined;
};

// "Let's Encrypt: 3, Custom: 1, mTLS CAs: 0", under the certificates header
function CertificateKinds({ kinds, id }) {
	if (!kinds) return null;
	return (
		<div id={id} className="mt-2 mb-0 text-xs text-muted-foreground">
			{CERTIFICATE_KINDS.map(([kind, labelId], index) => (
				<span key={kind}>
					{index > 0 ? ", " : null}
					<T id={labelId} data={{ count: kinds[kind] ?? 0 }} />
				</span>
			))}
		</div>
	);
}

// the rows or files of a type, "3 of 12" while only some of its items are chosen, undefined when unknown
const typeCount = (typeId, counts, itemCounts) => {
	const part = itemCounts?.[typeId];
	if (part && part.selected < part.total) {
		return <T id="settings.backup.items-of" data={{ selected: part.selected, total: part.total }} />;
	}
	return counts[typeId];
};

function TypeCount({ typeId, counts, itemCounts }) {
	const text = typeCount(typeId, counts, itemCounts);
	return text === undefined ? null : <span className="ml-1 text-muted-foreground">{text}</span>;
}

// the list button of a type whose items can be chosen one by one, with the open picker under it: an icon button
// joined to the type's pill, or for a box with one type a pill "Choose items 3 of 12"
function ChooseButton({ typeId, part, single, open, menuId, onChoose, disabled }) {
	const typeName = intl.formatMessage({ id: `settings.backup.type.${typeId}` });
	return (
		<Button
			type="button"
			variant="outline"
			size={single ? "sm" : "default"}
			className={cn(single ? "rounded-full" : "-ml-px rounded-l-none", "border-primary/40 text-primary")}
			aria-label={
				single
					? undefined
					: intl.formatMessage(
							{ id: "settings.backup.choose-type" },
							{ type: inSentence(typeName, intl.locale) },
						)
			}
			aria-expanded={open}
			aria-controls={open ? menuId : undefined}
			onClick={(e) => onChoose(typeId, e.currentTarget)}
			disabled={disabled}
		>
			<ListChecksIcon aria-hidden="true" />
			{single ? (
				<>
					<T id="settings.backup.choose-items" />
					<span className="ml-1 opacity-75">
						<T id="settings.backup.items-of" data={part} />
					</span>
				</>
			) : null}
		</Button>
	);
}

// a type as a checkbox card; joined: its end is square, for the list button after it
function TypePill({ typeId, checked, onChange, disabled, joined, counts, itemCounts }) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the Radix checkbox inside is a button, which labels the card
		<label
			className={cn(
				"flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-sm hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
				checked && "border-primary bg-primary/10",
				joined && "rounded-r-none",
			)}
		>
			<Checkbox checked={checked} onCheckedChange={onChange} disabled={disabled} />
			<span>
				<T id={`settings.backup.type.${typeId}`} />
				<TypeCount typeId={typeId} counts={counts} itemCounts={itemCounts} />
			</span>
		</label>
	);
}

// the category header: a checkbox (ticked, cleared or mixed) with the icon, the name and the count
function CategoryCheck({ category, state, count, onChange, disabled, labelId, describedBy }) {
	const Icon = CATEGORY_ICONS[category.id];
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the Radix checkbox inside is a button, which labels the header
		<label className="mb-0 flex cursor-pointer items-center gap-2 has-[:disabled]:cursor-not-allowed">
			<Checkbox
				checked={state === "some" ? "indeterminate" : state === "all"}
				onCheckedChange={onChange}
				disabled={disabled}
				aria-describedby={describedBy}
			/>
			{Icon ? <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
			<span id={labelId} className="font-bold">
				<T id={category.labelId ?? `settings.backup.category.${category.id}`} />
			</span>
			{count === undefined ? null : (
				<Badge variant="secondary" className="ml-auto">
					{count}
				</Badge>
			)}
		</label>
	);
}

/**
 * The backup parts as select boxes in a grid arranged by size (see arrangeRows: boxes of a similar size share a row
 * and its height): one box per category with a header checkbox (ticked, cleared or mixed), the types of a category
 * with several as pill toggles inside the box. Counts per category and type, the certificates
 * with their kinds when given. A label row with "Select all" and "None".
 *
 * @param {Object}    props
 * @param {ReactNode} [props.label]             the field label shown above the boxes
 * @param {Array}     props.categories          [{ id, types, labelId? }], labelId names the box instead of the category
 * @param {Object}    [props.counts]            type id -> rows or files
 * @param {Object}    [props.certificateKinds]  provider -> certificates (letsencrypt, other, mtls)
 * @param {string[]}  props.selected            the ticked type ids
 * @param {Function}  props.onChange            (selected) => void
 * @param {boolean}   [props.disabled]
 * @param {Object}    [props.itemCounts]        type id -> { selected, total } for the types whose items can be chosen
 *                                              one by one; a pill then shows "3 of 12" while some are left out
 * @param {Function}  [props.onChooseItems]     (typeId, button) => void, a list button per selected type of
 *                                              itemCounts: joined to its pill, or "Choose items" in a box of one type
 * @param {string}    [props.openType]          the type whose item picker is open
 * @param {ReactNode} [props.picker]            that picker, a card shown under its button
 * @param {string}    [props.pickerId]          the id of the picker, for aria-controls
 */
function TypeTree({
	label,
	categories,
	counts = {},
	certificateKinds,
	selected,
	onChange,
	disabled = false,
	itemCounts,
	onChooseItems,
	openType,
	picker,
	pickerId,
}) {
	const baseId = useId();
	const allTypes = categories.flatMap((category) => category.types);
	const allSelected = allTypes.length > 0 && allTypes.every((typeId) => selected.includes(typeId));
	// the list button of a selected type whose items can be chosen, with its picker when open
	const choosable = (typeId) => Boolean(onChooseItems && itemCounts?.[typeId] && selected.includes(typeId));
	const chooseButton = (typeId, single) => (
		<>
			<ChooseButton
				typeId={typeId}
				part={itemCounts[typeId]}
				single={single}
				open={openType === typeId}
				menuId={pickerId}
				onChoose={onChooseItems}
				disabled={disabled}
			/>
			{openType === typeId ? picker : null}
		</>
	);
	return (
		<div className="mb-3">
			<div className="mb-2 flex items-center">
				{label ? <div className="text-sm font-medium">{label}</div> : null}
				{/* Enter on "None" would clear every type: a window never starts here */}
				<div className="ml-auto flex gap-3" data-window-start-skip="">
					<Button
						type="button"
						variant="link"
						size="sm"
						className="h-auto min-h-6 p-0"
						onClick={() => onChange(allTypes)}
						disabled={disabled || allSelected}
					>
						<T id="settings.backup.select-all" />
					</Button>
					<Button
						type="button"
						variant="link"
						size="sm"
						className="h-auto min-h-6 p-0"
						onClick={() => onChange([])}
						disabled={disabled || selected.length === 0}
					>
						<T id="settings.backup.select-none" />
					</Button>
				</div>
			</div>
			{/* the boxes follow the width of their column (the section column is narrow next to the sidebar), not the window */}
			<div className="@container">
				<div className="grid grid-cols-1 gap-2 @xl:grid-cols-6">
					{arrangeRows(categories).flatMap((row) =>
						row.map((category) => {
							const labelId = `${baseId}-${category.id}`;
							const kindsId = `${labelId}-kinds`;
							const kinds = category.types.includes("certificates") ? certificateKinds : null;
							const state = categoryState(category, selected);
							const several = category.types.length > 1;
							return (
								<div key={category.id} className={row.length > 2 ? "@xl:col-span-2" : "@xl:col-span-3"}>
									<fieldset
										className={cn(
											"h-full rounded-lg border p-3",
											state !== "none" && "border-primary",
										)}
										aria-labelledby={labelId}
									>
										<div>
											<CategoryCheck
												category={category}
												state={state}
												count={
													several
														? categoryCount(category, counts)
														: typeCount(category.types[0], counts, itemCounts)
												}
												onChange={() => onChange(toggleCategory(category, selected))}
												disabled={disabled}
												labelId={labelId}
												describedBy={kinds ? kindsId : undefined}
											/>
											<CertificateKinds kinds={kinds} id={kindsId} />
											{several ? (
												<div className="mt-3 flex flex-wrap gap-2">
													{category.types.map((typeId) =>
														choosable(typeId) ? (
															<div key={typeId} className="relative flex">
																<TypePill
																	typeId={typeId}
																	checked={selected.includes(typeId)}
																	onChange={() =>
																		onChange(toggleType(typeId, selected))
																	}
																	disabled={disabled}
																	joined={true}
																	counts={counts}
																	itemCounts={itemCounts}
																/>
																{chooseButton(typeId, false)}
															</div>
														) : (
															<TypePill
																key={typeId}
																typeId={typeId}
																checked={selected.includes(typeId)}
																onChange={() => onChange(toggleType(typeId, selected))}
																disabled={disabled}
																joined={false}
																counts={counts}
																itemCounts={itemCounts}
															/>
														),
													)}
												</div>
											) : null}
											{!several && choosable(category.types[0]) ? (
												<div className="relative mt-3 inline-block">
													{chooseButton(category.types[0], true)}
												</div>
											) : null}
										</div>
									</fieldset>
								</div>
							);
						}),
					)}
				</div>
			</div>
		</div>
	);
}

export { TypeTree };
