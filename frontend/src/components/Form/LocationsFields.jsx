import cn from "clsx";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon, SearchIcon, SettingsIcon, Trash2Icon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { AccessFields, Button, SwitchField } from "src/components";
import { Input } from "src/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "src/components/ui/input-group";
import { NativeSelect } from "src/components/ui/native-select";
import { useIsAdmin } from "src/hooks";
import { intl, T } from "src/locale";
import { forwardSummary } from "src/modules/Forward";
import { newLocation } from "src/modules/ProxyHostForms";
import { NoticeAlert } from "../NoticeAlert";
import { FormField, TextField } from "./FormField";
import { FormSection } from "./FormSection";
import { useListRecheck, useReadOnly, useRecheckDependent } from "./HookForm";
import { ForwardFields, ProxyOptionsFields } from "./ProxyOptionsFields";

const locationLabel = (row) => `${row.locationType}${row.path}`;

// the remove and settings buttons of a row: ghost icon buttons
const ICON_BUTTON = "btn-ghost";

// one custom location: a bordered card with its header (path, target, config marker, remove) and, while open, its
// fields; row is the row's current values (the controlled field of LocationsFields)
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
	const pathId = `locationPath-${rowKey}`;
	const hasConfig = Boolean(row.advancedConfig?.trim());
	return (
		<div ref={cardRef} className={cn("rounded-lg border bg-card", hidden && "hidden")}>
			<div className="flex items-center gap-2 p-2">
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-md p-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
					aria-expanded={open}
					aria-controls={`location-body-${rowKey}`}
					onClick={onToggle}
				>
					{open ? (
						<ChevronDownIcon className="size-4 shrink-0" aria-hidden="true" />
					) : (
						<ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
					)}
					<span className="truncate font-medium">{locationLabel(row)}</span>
					<span className="truncate text-muted-foreground">{forwardSummary(row)}</span>
					{hasConfig ? (
						<span
							className="flex shrink-0 items-center text-muted-foreground"
							role="img"
							title={intl.formatMessage({ id: "nginx-config.label" })}
							aria-label={intl.formatMessage({ id: "nginx-config.label" })}
						>
							<SettingsIcon className="size-4" aria-hidden="true" />
						</span>
					) : null}
				</button>
				{readOnly ? null : (
					<Button
						className={cn(ICON_BUTTON, "text-destructive hover:text-destructive")}
						size="icon-sm"
						title={intl.formatMessage({ id: "action.delete" })}
						aria-label={intl.formatMessage({ id: "action.delete" })}
						onClick={onRemove}
					>
						<Trash2Icon aria-hidden="true" />
					</Button>
				)}
			</div>
			<div className={cn("flex flex-col gap-4 border-t p-4", !open && "hidden")} id={`location-body-${rowKey}`}>
				<fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
					<SwitchField
						id={`npmproEnabled-${rowKey}`}
						label={<T id="enabled" />}
						{...register(`${base}.npmproEnabled`)}
					/>
					<FormField id={pathId} label={<T id="location" />} required error={pathError} className="mb-0">
						{(control) => (
							<div className="flex gap-2">
								<NativeSelect
									id={`locationType-${rowKey}`}
									className="w-auto shrink-0"
									aria-labelledby={`${pathId}-label`}
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
								</NativeSelect>
								<Input
									type="text"
									{...register(`${base}.path`, { onChange: recheckPaths })}
									{...control}
									placeholder="/path"
									autoComplete="off"
									required
								/>
								{isAdmin || hasConfig ? (
									<Button
										className={cn(ICON_BUTTON, "w-auto shrink-0 px-2")}
										size="icon"
										title={intl.formatMessage({ id: "location.config.toggle" })}
										aria-label={intl.formatMessage({ id: "location.config.toggle" })}
										aria-expanded={advOpen}
										onClick={onToggleAdv}
									>
										<SettingsIcon aria-hidden="true" />
										{hasConfig ? "*" : ""}
									</Button>
								) : null}
							</div>
						)}
					</FormField>
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
				{advOpen ? (
					<TextField
						name={`${base}.advancedConfig`}
						id={`advancedConfig-${rowKey}`}
						as="textarea"
						label={<T id="location.config.label" />}
						hint={isAdmin ? undefined : <T id="nginx-config.admin-only" />}
						className="mb-0"
						controlClassName="font-mono"
						spellCheck={false}
						placeholder={intl.formatMessage({ id: "nginx-config.placeholder" })}
						rows={8}
						readOnly={!isAdmin || readOnly}
					/>
				) : null}
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
				<div className="my-3 text-center text-muted-foreground">
					<T id="location.none" />
				</div>
			);
		}
		return (
			<div className="text-center">
				<Button className="my-3" onClick={handleAdd}>
					<T id="action.add-location" />
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<InputGroup className="flex-1">
					<InputGroupAddon>
						<SearchIcon aria-hidden="true" />
					</InputGroupAddon>
					<InputGroupInput
						type="text"
						autoComplete="off"
						placeholder={intl.formatMessage({ id: "location.filter" })}
						aria-label={intl.formatMessage({ id: "location.filter" })}
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
					/>
					<InputGroupAddon align="inline-end">
						<InputGroupButton
							size="icon-xs"
							title={intl.formatMessage({ id: "action.clear" })}
							aria-label={intl.formatMessage({ id: "action.clear" })}
							onClick={() => setFilter("")}
						>
							<XIcon aria-hidden="true" />
						</InputGroupButton>
					</InputGroupAddon>
				</InputGroup>
				{readOnly ? null : (
					<Button onClick={handleAdd}>
						<PlusIcon data-icon="inline-start" aria-hidden="true" />
						<T id="action.add-location" />
					</Button>
				)}
			</div>
			{!controlledFields.some(matchesFilter) && (
				<div className="my-3 text-center text-muted-foreground">
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
		</div>
	);
}
