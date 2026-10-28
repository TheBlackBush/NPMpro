import {
	IconFileCode,
	IconKey,
	IconListCheck,
	IconLock,
	IconServer2,
	IconSettings,
	IconShield,
	IconUsers,
} from "@tabler/icons-react";
import cn from "clsx";
import { useEffect, useId, useRef } from "react";
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
	hosts: IconServer2,
	certificates: IconShield,
	access_lists: IconLock,
	dns_credentials: IconKey,
	users: IconUsers,
	settings: IconSettings,
	custom_files: IconFileCode,
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
		<div id={id} className="form-hint mt-2 mb-0">
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
	return text === undefined ? null : <span className="text-secondary ms-1">{text}</span>;
}

// the list button of a type whose items can be chosen one by one, with the open picker under it: an icon button
// joined to the type's pill, or for a box with one type a pill "Choose items 3 of 12"
function ChooseButton({ typeId, part, single, open, menuId, onChoose, disabled }) {
	const typeName = intl.formatMessage({ id: `settings.backup.type.${typeId}` });
	return (
		<button
			type="button"
			className={cn("btn btn-outline-primary", single ? "btn-sm btn-pill" : "btn-icon rounded-end-pill")}
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
			<IconListCheck className={cn("icon", single && "me-1")} aria-hidden="true" />
			{single ? (
				<>
					<T id="settings.backup.choose-items" />
					<span className="ms-1 opacity-75">
						<T id="settings.backup.items-of" data={part} />
					</span>
				</>
			) : null}
		</button>
	);
}

// a type as a pill toggle; joined: its end is square, for the list button after it
function TypePill({ typeId, checked, onChange, disabled, joined, counts, itemCounts }) {
	return (
		<label className="form-selectgroup-item">
			<input
				type="checkbox"
				className="form-selectgroup-input"
				checked={checked}
				onChange={onChange}
				disabled={disabled}
			/>
			<span className={cn("form-selectgroup-label", joined && "rounded-end-0")}>
				<T id={`settings.backup.type.${typeId}`} />
				<TypeCount typeId={typeId} counts={counts} itemCounts={itemCounts} />
			</span>
		</label>
	);
}

// the category header: a checkbox (ticked, cleared or mixed) with the icon, the name and the count
function CategoryCheck({ category, state, count, onChange, disabled, labelId, describedBy }) {
	const ref = useRef(null);
	// indeterminate exists only as a DOM property
	useEffect(() => {
		if (ref.current) ref.current.indeterminate = state === "some";
	}, [state]);
	const Icon = CATEGORY_ICONS[category.id];
	return (
		<label className="d-flex align-items-center gap-2 mb-0 cursor-pointer">
			<input
				ref={ref}
				className="form-check-input m-0"
				type="checkbox"
				checked={state === "all"}
				onChange={onChange}
				disabled={disabled}
				aria-checked={state === "some" ? "mixed" : undefined}
				aria-describedby={describedBy}
			/>
			{Icon ? <Icon className="icon text-secondary" aria-hidden="true" /> : null}
			<span id={labelId} className="fw-bold">
				<T id={category.labelId ?? `settings.backup.category.${category.id}`} />
			</span>
			{count === undefined ? null : <span className="badge bg-secondary-lt ms-auto">{count}</span>}
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
 * @param {ReactNode} [props.picker]            that picker, a dropdown menu shown under its button
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
			<div className="d-flex align-items-center mb-2">
				{label ? <div className="form-label mb-0">{label}</div> : null}
				<div className="ms-auto d-flex gap-3">
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						onClick={() => onChange(allTypes)}
						disabled={disabled || allSelected}
					>
						<T id="settings.backup.select-all" />
					</button>
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						onClick={() => onChange([])}
						disabled={disabled || selected.length === 0}
					>
						<T id="settings.backup.select-none" />
					</button>
				</div>
			</div>
			<div className="row g-2">
				{arrangeRows(categories).flatMap((row) =>
					row.map((category) => {
						const labelId = `${baseId}-${category.id}`;
						const kindsId = `${labelId}-kinds`;
						const kinds = category.types.includes("certificates") ? certificateKinds : null;
						const state = categoryState(category, selected);
						const several = category.types.length > 1;
						return (
							<div key={category.id} className={row.length > 2 ? "col-12 col-md-4" : "col-12 col-md-6"}>
								<fieldset
									className={cn("card card-sm h-100", state !== "none" && "border-primary")}
									aria-labelledby={labelId}
								>
									<div className="card-body">
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
											<div className="form-selectgroup form-selectgroup-pills mt-3">
												{category.types.map((typeId) =>
													choosable(typeId) ? (
														<div key={typeId} className="btn-group">
															<TypePill
																typeId={typeId}
																checked={selected.includes(typeId)}
																onChange={() => onChange(toggleType(typeId, selected))}
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
											<div className="dropdown d-inline-block mt-3">
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
	);
}

export { TypeTree };
