import {
	IconChevronDown,
	IconChevronRight,
	IconPlus,
	IconSearch,
	IconSettings,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import cn from "clsx";
import { useLayoutEffect, useRef, useState } from "react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { AccessFields, SwitchField } from "src/components";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";
import { forwardSummary } from "src/modules/Forward";
import { newLocation } from "src/modules/ProxyHostForms";
import { NoticeAlert } from "../NoticeAlert";
import { FormSection } from "./FormSection";
import { useListRecheck, useReadOnly, useRecheckDependent } from "./HookForm";
import { ForwardFields, ProxyOptionsFields } from "./ProxyOptionsFields";

const locationLabel = (row) => `${row.locationType}${row.path}`;

// one custom location: a card with its header (path, target, config marker) and, while open, its fields; row is
// the row's current values (the controlled field of LocationsFields)
function LocationRow({
	name,
	index,
	rowKey,
	row,
	isAdmin,
	readOnly,
	open,
	hidden,
	advOpen,
	onToggle,
	onToggleAdv,
	onRemove,
	recheckPaths,
	cardRef,
}) {
	const { register, getFieldState } = useFormContext();
	const base = `${name}.${index}`;
	const formState = useFormState({ name: base });
	const recheckPath = useRecheckDependent(`${base}.path`);
	const pathError = getFieldState(`${base}.path`, formState).error?.message ?? null;
	return (
		<div
			ref={cardRef}
			className={cn("card", "card-active", "mb-2", hidden && "d-none")}
			style={{ "--tblr-card-border-color": "var(--tblr-border-color)" }}
		>
			<div className={cn("card-header", "p-2", !open && "border-bottom-0")}>
				<button
					type="button"
					className="d-flex flex-fill align-self-stretch align-items-center overflow-hidden p-0 text-start text-body bg-transparent border-0"
					aria-expanded={open}
					aria-controls={`location-body-${rowKey}`}
					onClick={onToggle}
				>
					{open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
					<span className="ms-2 fw-medium text-truncate">{locationLabel(row)}</span>
					<span className="ms-2 text-secondary text-truncate">{forwardSummary(row)}</span>
					{row.advancedConfig?.trim() && (
						<span
							className="ms-2 text-secondary d-flex align-items-center flex-shrink-0"
							role="img"
							title={intl.formatMessage({ id: "nginx-config.label" })}
							aria-label={intl.formatMessage({ id: "nginx-config.label" })}
						>
							<IconSettings size={16} />
						</span>
					)}
				</button>
				{readOnly ? null : (
					<button
						type="button"
						className="btn btn-action ms-2"
						title={intl.formatMessage({ id: "action.delete" })}
						aria-label={intl.formatMessage({ id: "action.delete" })}
						onClick={onRemove}
					>
						<IconTrash size={16} className="icon" />
					</button>
				)}
			</div>
			<div className={cn("card-body", !open && "d-none")} id={`location-body-${rowKey}`}>
				<fieldset disabled={readOnly}>
					<div className="row mb-3">
						<SwitchField
							id={`npmproEnabled-${rowKey}`}
							label={<T id="enabled" />}
							{...register(`${base}.npmproEnabled`)}
						/>
					</div>
					<div className="row">
						<div className="col-md-10">
							<div className="input-group mb-3">
								<span className="input-group-text">
									<T id="location" />
								</span>
								<select
									id={`locationType-${rowKey}`}
									className="form-select w-auto flex-grow-0"
									{...register(`${base}.locationType`, {
										// the type and the path together must be unique
										onChange: () => {
											recheckPath();
											recheckPaths();
										},
									})}
								>
									<option value="" />
									<option value="@">@</option>
									<option value="= ">=</option>
									<option value="~ ">~</option>
									<option value="~* ">~*</option>
									<option value="^~ ">^~</option>
								</select>
								<input
									type="text"
									{...register(`${base}.path`, { onChange: recheckPaths })}
									className={cn("form-control", pathError && "is-invalid")}
									placeholder="/path"
									autoComplete="off"
									required
									aria-label={intl.formatMessage({ id: "location.path" })}
									aria-invalid={pathError ? "true" : undefined}
								/>
								{pathError ? <div className="invalid-feedback">{pathError}</div> : null}
							</div>
						</div>
						<div className="col-md-2 text-end">
							{(isAdmin || row.advancedConfig?.trim()) && (
								<button
									type="button"
									className="btn p-0"
									title={intl.formatMessage({ id: "location.config.toggle" })}
									aria-label={intl.formatMessage({ id: "location.config.toggle" })}
									aria-expanded={advOpen}
									onClick={onToggleAdv}
								>
									<IconSettings size={20} />
									{row.advancedConfig?.trim() ? "*" : ""}
								</button>
							)}
						</div>
					</div>
					{!row.path?.endsWith("/") && (row.locationType === "" || row.locationType === "^~ ") && (
						<NoticeAlert role="status">
							<T id="proxy-host.location-no-trailing-slash-warning" />
						</NoticeAlert>
					)}
					<ForwardFields base={base} idSuffix={rowKey} />
					<ProxyOptionsFields base={base} idSuffix={rowKey} />
					<FormSection heading legend={<T id="proxy-host.access-lists" />} className="mb-0">
						<AccessFields
							name={`${base}.npmproAccessListIds`}
							typeName={`${base}.npmproAccessListType`}
							location={row.path}
							authRequest={row.npmproAuthRequest}
						/>
					</FormSection>
				</fieldset>
				{/* outside the disabled fieldset of a View window: read-only, so it can still be focused and scrolled */}
				{advOpen && (
					<div className="">
						<label className="form-label" htmlFor={`advancedConfig-${rowKey}`}>
							<T id="location.config.label" />
						</label>
						<textarea
							id={`advancedConfig-${rowKey}`}
							className="form-control font-monospace"
							spellCheck={false}
							placeholder={intl.formatMessage({
								id: "nginx-config.placeholder",
							})}
							{...register(`${base}.advancedConfig`)}
							rows={8}
							readOnly={!isAdmin || readOnly}
							aria-describedby={isAdmin ? undefined : `advancedConfig-hint-${rowKey}`}
						/>
						{!isAdmin && (
							<div className="form-hint" id={`advancedConfig-hint-${rowKey}`}>
								<T id="nginx-config.admin-only" />
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

/**
 * The custom locations of a proxy host (useFieldArray over the form's locations): a filter, Add, and one card per
 * location. A new card opens and scrolls into view; after a refused save a card with a message is open and shown
 * whatever the filter. In a View window (useReadOnly) the cards still open and close, their fields are disabled and
 * a custom nginx config shows without its button; nothing can be added or removed.
 *
 * @param {Object} props
 * @param {string} [props.name]
 */
export function LocationsFields({ name = "locations" }) {
	const isAdmin = useIsAdmin();
	const readOnly = useReadOnly();
	const { fields, append, remove } = useFieldArray({ name });
	const rows = useWatch({ name });
	// the documented controlled field array: the keys of fields with the current values of the rows (useWatch may
	// still hold the list before an append or a removal)
	const controlledFields = fields.map((field, index) => ({ ...field, ...rows?.[index] }));
	const { getFieldState } = useFormContext();
	const formState = useFormState({ name });
	const { isSubmitted } = formState;
	const { afterRemove, recheckRows } = useListRecheck(name);
	const [advVisible, setAdvVisible] = useState([]);
	const [expanded, setExpanded] = useState([]);
	const [filter, setFilter] = useState("");
	const scrollToKey = useRef(null);
	const added = useRef(false);
	// the card element of each row, by row key
	const cards = useRef(new Map());

	// the row Add appended: open it (its key exists once useFieldArray rendered it)
	useLayoutEffect(() => {
		if (!added.current) return;
		added.current = false;
		const key = fields.at(-1)?.id;
		scrollToKey.current = key;
		setExpanded((list) => [...list, key]);
	}, [fields]);

	// then, once it renders open, scroll it into view
	useLayoutEffect(() => {
		const key = scrollToKey.current;
		if (!(key && expanded.includes(key))) return;
		scrollToKey.current = null;
		cards.current.get(key)?.scrollIntoView({ block: "nearest" });
	}, [expanded]);

	const toggle = (key, list, set) => set(list.includes(key) ? list.filter((i) => i !== key) : [...list, key]);
	// after a refused save a row with an error is open and not filtered away, so its error can be seen
	const forcedOpen = (index) => isSubmitted && Boolean(getFieldState(`${name}.${index}`, formState).error);

	const handleAdd = () => {
		added.current = true;
		append(newLocation(), { shouldFocus: false });
		setFilter("");
	};

	const handleRemove = (index) => {
		remove(index);
		afterRemove();
	};

	const matchesFilter = (row) =>
		`${locationLabel(row)} ${forwardSummary(row)}`.toLowerCase().includes(filter.trim().toLowerCase());

	if (fields.length === 0) {
		if (readOnly) {
			return (
				<div className="text-secondary text-center my-3">
					<T id="location.none" />
				</div>
			);
		}
		return (
			<div className="text-center">
				<button type="button" className="btn my-3" onClick={handleAdd}>
					<T id="action.add-location" />
				</button>
			</div>
		);
	}

	return (
		<>
			<div className="row g-2 mb-3">
				<div className="col">
					<div className="input-group">
						<span className="input-group-text">
							<IconSearch size={16} />
						</span>
						<input
							type="text"
							className="form-control"
							autoComplete="off"
							placeholder={intl.formatMessage({ id: "location.filter" })}
							aria-label={intl.formatMessage({ id: "location.filter" })}
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
						/>

						<button
							type="button"
							className="btn btn-icon"
							title={intl.formatMessage({ id: "action.clear" })}
							aria-label={intl.formatMessage({ id: "action.clear" })}
							onClick={() => setFilter("")}
						>
							<IconX size={16} />
						</button>
					</div>
				</div>
				{readOnly ? null : (
					<div className="col-auto">
						<button type="button" className="btn" onClick={handleAdd}>
							<IconPlus size={16} className="me-1" />
							<T id="action.add-location" />
						</button>
					</div>
				)}
			</div>
			{!controlledFields.some(matchesFilter) && (
				<div className="text-secondary text-center my-3">
					<T id="empty-search" />
				</div>
			)}
			{controlledFields.map((field, index) => (
				<LocationRow
					key={field.id}
					name={name}
					index={index}
					rowKey={field.id}
					row={field}
					isAdmin={isAdmin}
					readOnly={readOnly}
					open={expanded.includes(field.id) || forcedOpen(index)}
					hidden={!matchesFilter(field) && !forcedOpen(index)}
					advOpen={advVisible.includes(field.id) || (readOnly && Boolean(field.advancedConfig?.trim()))}
					onToggle={() => toggle(field.id, expanded, setExpanded)}
					onToggleAdv={() => toggle(field.id, advVisible, setAdvVisible)}
					onRemove={() => handleRemove(index)}
					recheckPaths={() => recheckRows("path")}
					cardRef={(node) => {
						if (node) cards.current.set(field.id, node);
						else cards.current.delete(field.id);
					}}
				/>
			))}
		</>
	);
}
