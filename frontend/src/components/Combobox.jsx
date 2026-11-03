import { Command as CommandRoot, useCommandState } from "cmdk";
import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "src/components/ui/command";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { addEntries, canCreate, filterOptions, isEmptyValue, partitionEntries, removeLast } from "src/modules/Combobox";
import { joinIds } from "src/modules/FormFields";

// the cmdk value of the "Add ..." item; option items are "o:" and their value
const CREATE_KEY = "create:";
const optionKey = (value) => `o:${String(value)}`;
// pasted text with a separator is a list of entries (Combobox.js splitEntries)
const LIST_TEXT = /[\s,]/u;

const defaultLabel = (option) => option?.label;
const defaultValue = (option) => option?.value;
const defaultNormalize = (entry) => String(entry).trim().toLowerCase();

// a text prop that may depend on the query: a string, or (query) => string
const textFor = (text, query) => (typeof text === "function" ? text(query) : text);

// The window around a combobox (a Radix Dialog or Sheet) locks scrolling outside itself, and the list is portalled out
// of it: wheel and touch scrolling of the list must not reach the window's document listener, or it is cancelled
const keepScroll = {
	onWheel: (event) => event.stopPropagation(),
	onTouchMove: (event) => event.stopPropagation(),
};

const popoverClass = "w-(--radix-popover-trigger-width) min-w-48 gap-0 p-0";

// the label of a value: its option's label, or the value itself (a typed one, or one the options do not list)
function labelOf(value, options, getOptionLabel, getOptionValue) {
	const option = options.find((o) => getOptionValue(o) === value);
	return option ? getOptionLabel(option) : String(value);
}

/**
 * The options a query shows and the "Add ..." entry, shared by both modes
 *
 * @returns {{ items: Object[], createLabel: string|null, keys: string[] }}
 */
function listFor({
	options,
	query,
	values,
	multiple,
	creatable,
	isValidNew,
	getOptionLabel,
	getOptionValue,
	createText,
}) {
	const chosen = new Set(values.map(String));
	// a multiple field does not offer what it already holds
	const pool = multiple ? options.filter((option) => !chosen.has(String(getOptionValue(option)))) : options;
	const items = filterOptions(pool, query, getOptionLabel);
	const trimmed = query.trim();
	const labels = values.map((value) => labelOf(value, options, getOptionLabel, getOptionValue));
	const offer =
		creatable &&
		canCreate(trimmed, options, multiple ? labels : [], getOptionLabel) &&
		(isValidNew ? isValidNew(trimmed, values) : true);
	const createLabel = offer
		? (textFor(createText, trimmed) ?? intl.formatMessage({ id: "combobox.create" }, { value: trimmed }))
		: null;
	const keys = [
		...items.filter((option) => !option.disabled).map((option) => optionKey(getOptionValue(option))),
		...(createLabel ? [CREATE_KEY] : []),
	];
	return { items, createLabel, keys };
}

/**
 * The listbox: the options (rich rows through renderOption), "Add ...", and the empty or loading text
 */
function ComboboxItems({
	list,
	listRef,
	selectedKey,
	loading,
	emptyText,
	query,
	renderOption,
	getOptionLabel,
	getOptionValue,
	onPick,
	onCreate,
}) {
	return (
		<CommandList ref={listRef} label={intl.formatMessage({ id: "combobox.options" })}>
			<CommandEmpty className="py-4">
				{loading
					? intl.formatMessage({ id: "loading" })
					: (textFor(emptyText, query.trim()) ?? intl.formatMessage({ id: "combobox.empty" }))}
			</CommandEmpty>
			{list.items.length > 0 || list.createLabel ? (
				<div className="p-1">
					{list.items.map((option) => {
						const key = optionKey(getOptionValue(option));
						return (
							<CommandItem
								key={key}
								value={key}
								disabled={Boolean(option.disabled)}
								data-checked={key === selectedKey}
								onSelect={() => onPick(option)}
							>
								<div className="min-w-0 flex-1">
									{renderOption ? renderOption(option) : getOptionLabel(option)}
								</div>
							</CommandItem>
						);
					})}
					{list.createLabel ? (
						<CommandItem value={CREATE_KEY} onSelect={onCreate}>
							<span className="min-w-0 flex-1 break-all">{list.createLabel}</span>
						</CommandItem>
					) : null}
				</div>
			) : null}
		</CommandList>
	);
}

// the id of a mounted element, kept in state by a callback ref (the listbox, for aria-controls)
function useElementId() {
	const [element, setElement] = useState(null);
	const ref = useCallback((node) => setElement(node), []);
	return [element, ref];
}

/**
 * One value from a list: a button that opens the list, with a search box (unless searchable is false)
 */
function SingleCombobox({
	id,
	inputRef,
	focusRef,
	value,
	onChange,
	options,
	creatable,
	clearable,
	searchable,
	placeholder,
	disabled,
	readOnly,
	loading,
	renderOption,
	getOptionLabel,
	getOptionValue,
	emptyText,
	createText,
	isValidNew,
	onBlur,
	aria,
	className,
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [listElement, listRef] = useElementId();
	const searchRef = useRef(null);
	const rootRef = useRef(null);
	const locked = disabled || readOnly;
	const empty = isEmptyValue(value);
	const selected = empty ? null : options.find((o) => getOptionValue(o) === value);
	const selectedKey = empty ? null : optionKey(value);
	const shown = empty ? null : selected ? getOptionLabel(selected) : String(value);
	const list = listFor({
		options,
		query,
		values: [],
		multiple: false,
		creatable,
		isValidNew,
		getOptionLabel,
		getOptionValue,
		createText,
	});

	const changeOpen = (next, seed = "") => {
		if (next && locked) return;
		setQuery(next ? seed : "");
		setOpen(next);
	};
	const pick = (option) => {
		onChange(getOptionValue(option), option);
		changeOpen(false);
	};
	const create = () => {
		onChange(query.trim(), null);
		changeOpen(false);
	};

	// closed: the arrows open the list, a typed character opens it with that character in the search box
	const onTriggerKeyDown = (event) => {
		if (open || locked) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			changeOpen(true);
		} else if (searchable && event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey) {
			event.preventDefault();
			changeOpen(true, event.key);
		} else if (clearable && !empty && (event.key === "Backspace" || event.key === "Delete")) {
			event.preventDefault();
			onChange(null, null);
		}
	};
	// Tab inside the list closes it (focus goes back to the button) instead of leaving the window's focus scope
	const onListKeyDown = (event) => {
		if (event.key === "Tab") {
			event.preventDefault();
			changeOpen(false);
		}
	};
	// focus the search box with the caret after a seeded character (Radix would select the text), or the list itself
	const onOpenAutoFocus = (event) => {
		event.preventDefault();
		const input = searchRef.current;
		if (input) {
			input.focus();
			input.setSelectionRange(input.value.length, input.value.length);
		} else {
			rootRef.current?.focus();
		}
	};

	return (
		<Popover open={open} onOpenChange={(next) => changeOpen(next)}>
			<div className={cn("relative w-full", className)}>
				<PopoverTrigger asChild>
					<Button
						ref={inputRef}
						id={id}
						type="button"
						variant="outline"
						role="combobox"
						aria-haspopup="listbox"
						aria-expanded={open}
						aria-controls={open ? listElement?.id : undefined}
						aria-readonly={readOnly ? "true" : undefined}
						{...aria}
						disabled={disabled}
						data-readonly={readOnly ? "" : undefined}
						className={cn(
							"w-full justify-between font-normal data-readonly:cursor-default",
							clearable && !empty && !locked && "pr-14",
						)}
						onKeyDown={onTriggerKeyDown}
						// focus moving into the open list is not leaving the field (the form validates on blur)
						onBlur={open ? undefined : onBlur}
					>
						<span className={cn("min-w-0 truncate text-left", shown === null && "text-muted-foreground")}>
							{shown ?? placeholder ?? " "}
						</span>
						<ChevronsUpDownIcon data-icon="inline-end" aria-hidden="true" className="opacity-50" />
					</Button>
				</PopoverTrigger>
				{clearable && !empty && !locked ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="absolute top-1/2 right-7 -translate-y-1/2"
						aria-label={intl.formatMessage({ id: "action.clear" })}
						onClick={() => {
							onChange(null, null);
							// this button goes away with the value: the focus stays in the field
							focusRef.current?.focus();
						}}
					>
						<XIcon aria-hidden="true" />
					</Button>
				) : null}
			</div>
			<PopoverContent align="start" className={popoverClass} onOpenAutoFocus={onOpenAutoFocus} {...keepScroll}>
				<Command
					ref={rootRef}
					shouldFilter={false}
					defaultValue={selectedKey ?? undefined}
					label={intl.formatMessage({ id: "search" })}
					onKeyDown={onListKeyDown}
				>
					{searchable ? (
						<CommandInput
							ref={searchRef}
							value={query}
							onValueChange={setQuery}
							placeholder={intl.formatMessage({ id: "search" })}
						/>
					) : null}
					<ComboboxItems
						list={list}
						listRef={listRef}
						selectedKey={selectedKey}
						loading={loading}
						emptyText={emptyText}
						query={query}
						renderOption={renderOption}
						getOptionLabel={getOptionLabel}
						getOptionValue={getOptionValue}
						onPick={pick}
						onCreate={create}
					/>
				</Command>
			</PopoverContent>
		</Popover>
	);
}

/**
 * The text input of a multiple combobox, inside cmdk's root so its keys move through the list. cmdk renders no
 * input of its own here, so this one carries the combobox attributes, the active option included.
 */
function ChipsInput({ open, listElement, inputRef, ...props }) {
	// subscribed to the active option, so this renders again when it changes; after each render the id is read
	// from the listbox (cmdk gives its items their own ids). An unchanged id does not render again.
	useCommandState((state) => state.value);
	const [activeId, setActiveId] = useState(undefined);
	useLayoutEffect(() => {
		const item = open ? listElement?.querySelector('[cmdk-item][aria-selected="true"]') : null;
		setActiveId(item?.id || undefined);
	});
	return (
		<input
			ref={inputRef}
			type="text"
			role="combobox"
			aria-autocomplete="list"
			aria-haspopup="listbox"
			aria-expanded={open}
			aria-controls={open ? listElement?.id : undefined}
			aria-activedescendant={open ? activeId : undefined}
			autoComplete="off"
			autoCorrect="off"
			spellCheck={false}
			{...props}
		/>
	);
}

/**
 * A list of values as chips with a text input: typing filters the options (and, creatable, offers the typed value),
 * Enter or a comma adds, a pasted list adds every entry, Backspace in the empty input removes the last chip
 */
function MultipleCombobox({
	id,
	inputRef,
	focusRef,
	value,
	onChange,
	options,
	creatable,
	placeholder,
	disabled,
	readOnly,
	loading,
	renderOption,
	getOptionLabel,
	getOptionValue,
	emptyText,
	createText,
	isValidNew,
	normalize,
	commitRef,
	onQueryChange,
	onBlur,
	aria,
	className,
}) {
	const values = Array.isArray(value) ? value : [];
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState("");
	const [listElement, listRef] = useElementId();
	const anchorRef = useRef(null);
	const contentRef = useRef(null);
	const locked = disabled || readOnly;
	const listArgs = {
		options,
		values,
		multiple: true,
		creatable,
		isValidNew,
		getOptionLabel,
		getOptionValue,
		createText,
	};
	const list = listFor({ ...listArgs, query });
	// nothing to list: an empty creatable field (domain names) stays closed until something is typed
	const hasContent = loading || list.keys.length > 0 || query.trim() !== "";
	const shown = open && hasContent && !locked;

	const changeQuery = (text) => {
		setQuery(text);
		onQueryChange?.(text);
	};
	const typed = (text) => {
		changeQuery(text);
		setActive(listFor({ ...listArgs, query: text }).keys[0] ?? "");
		if (!locked) setOpen(true);
	};
	// add the valid entries of a text; the others stay in the input to be corrected
	const commit = (text) => {
		const { accepted, rejected } = partitionEntries(text, (entry) =>
			isValidNew ? isValidNew(entry, values) : true,
		);
		const next = addEntries(values, accepted.join(" "), { normalize });
		if (next.length !== values.length) onChange(next);
		typed(rejected.join(" "));
		if (rejected.length === 0) setOpen(false);
		return rejected;
	};
	// the form commits typed text before a save (HookForm's usePendingEntry): the refused parts, none without text
	useLayoutEffect(() => {
		if (!commitRef) return;
		commitRef.current = () => (creatable && !locked && query.trim() !== "" ? commit(query) : []);
	});
	const pick = (option) => {
		const picked = getOptionValue(option);
		if (!values.includes(picked)) onChange([...values, picked]);
		changeQuery("");
		setOpen(false);
		focusRef.current?.focus();
	};
	const remove = (index) => {
		onChange(values.filter((_, i) => i !== index));
		focusRef.current?.focus();
	};

	const onKeyDown = (event) => {
		if (locked) return;
		const key = event.key;
		const highlighted = shown && list.keys.includes(active);
		if (key === "Home" || key === "End") {
			// the caret moves in the text, cmdk must not take these keys
			event.stopPropagation();
		} else if ((key === "ArrowDown" || key === "ArrowUp") && !shown) {
			event.preventDefault();
			event.stopPropagation();
			typed(query);
		} else if (key === "Enter" && !highlighted) {
			// no option to choose: add what was typed (creatable), or open the list
			event.preventDefault();
			event.stopPropagation();
			if (creatable && query.trim() !== "") commit(query);
			else typed(query);
		} else if (key === "," && creatable) {
			event.preventDefault();
			commit(query);
		} else if (key === "Backspace" && query === "" && values.length > 0) {
			event.preventDefault();
			onChange(removeLast(values));
		} else if (key === "Tab" && shown) {
			setOpen(false);
		}
	};
	const onPaste = (event) => {
		const text = event.clipboardData?.getData("text") ?? "";
		if (!(creatable && LIST_TEXT.test(text)) || locked) return;
		event.preventDefault();
		commit(`${query} ${text}`);
	};
	const onInputBlur = (event) => {
		// a tap on the list (touch browsers may move the focus there): the item's click still has to arrive
		if (contentRef.current?.contains(event.relatedTarget)) return;
		// a typed value is not lost when the user moves on (to Save)
		if (creatable && query.trim() !== "" && !locked) commit(query);
		setOpen(false);
		onBlur?.(event);
	};

	return (
		<CommandRoot shouldFilter={false} value={active} onValueChange={setActive} className={cn("w-full", className)}>
			<Popover open={shown} onOpenChange={setOpen}>
				<PopoverAnchor asChild>
					{/* a click on the box (between chips) puts the caret in the input, as in a text field */}
					{/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions lint/a11y/useKeyWithClickEvents: a pointer convenience only, the input inside is the keyboard target */}
					<div
						ref={anchorRef}
						data-slot="combobox-chips"
						data-disabled={disabled ? "" : undefined}
						className={cn(
							"flex min-h-8 w-full min-w-0 cursor-text flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 text-base transition-colors md:text-sm dark:bg-input/30",
							"focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
							"has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 dark:has-aria-invalid:border-destructive/50",
							"data-disabled:cursor-not-allowed data-disabled:bg-input/50 data-disabled:opacity-50",
						)}
						onClick={(event) => {
							if (event.target === event.currentTarget) focusRef.current?.focus();
						}}
					>
						{values.map((entry, index) => {
							const label = labelOf(entry, options, getOptionLabel, getOptionValue);
							return (
								<Badge
									key={String(entry)}
									variant="secondary"
									className="h-6 max-w-full gap-0.5 pr-0.5 text-sm font-normal"
								>
									<span className="truncate">{label}</span>
									{locked ? null : (
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											className="size-5 rounded-full"
											aria-label={intl.formatMessage({ id: "combobox.remove" }, { value: label })}
											onClick={() => remove(index)}
										>
											<XIcon aria-hidden="true" />
										</Button>
									)}
								</Badge>
							);
						})}
						<ChipsInput
							open={shown}
							listElement={listElement}
							inputRef={inputRef}
							id={id}
							{...aria}
							value={query}
							disabled={disabled}
							readOnly={readOnly}
							placeholder={values.length === 0 ? placeholder : undefined}
							className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
							onChange={(event) => typed(event.target.value)}
							onClick={() => (locked ? undefined : typed(query))}
							onKeyDown={onKeyDown}
							onPaste={onPaste}
							onBlur={onInputBlur}
						/>
					</div>
				</PopoverAnchor>
				<PopoverContent
					ref={contentRef}
					align="start"
					className={popoverClass}
					// the input keeps the focus: the list is only pointed at (aria-activedescendant)
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
					onInteractOutside={(event) => {
						if (anchorRef.current?.contains(event.target)) event.preventDefault();
					}}
					onMouseDown={(event) => event.preventDefault()}
					{...keepScroll}
				>
					<ComboboxItems
						list={list}
						listRef={listRef}
						selectedKey={null}
						loading={loading}
						emptyText={emptyText}
						query={query}
						renderOption={renderOption}
						getOptionLabel={getOptionLabel}
						getOptionValue={getOptionValue}
						onPick={pick}
						onCreate={() => {
							commit(query);
							focusRef.current?.focus();
						}}
					/>
				</PopoverContent>
			</Popover>
		</CommandRoot>
	);
}

/**
 * A searchable choice on Popover and Command (WAI-ARIA combobox): one value (a button that opens the list) or, with
 * multiple, a list of values as chips with a text input. creatable lets the user add values the options do not list.
 * Works inside a window (Dialog or Sheet): the list is portalled as a Radix layer above it, so Escape closes only the
 * list. Spread FormField's control on it (id, aria-invalid, aria-describedby, aria-required), or pass invalid and
 * describedBy.
 *
 * @param {Object}   props
 * @param {string}   [props.id]              the control's id (the label points at it)
 * @param {*}        props.value             the option value or null; an array with multiple
 * @param {Function} props.onChange          single: (value, option|null), null when cleared, option null when
 *                                           created; multiple: (values)
 * @param {Object[]} [props.options]         { value, label, disabled, ...data }
 * @param {boolean}  [props.multiple]
 * @param {boolean}  [props.creatable]
 * @param {boolean}  [props.clearable]       single: a clear button (and Backspace or Delete on the button)
 * @param {boolean}  [props.searchable]      single: the search box, true by default
 * @param {boolean}  [props.loading]         the list says it is loading instead of the empty text
 * @param {string}   [props.placeholder]
 * @param {boolean}  [props.disabled]
 * @param {boolean}  [props.readOnly]        shows the value, does not open, chips without remove buttons
 * @param {Function} [props.renderOption]    (option) => the row in the list (rich rows)
 * @param {Function} [props.getOptionLabel]  (option) => its label, used for filtering and display
 * @param {Function} [props.getOptionValue]  (option) => its value
 * @param {string|Function} [props.emptyText]   or (query) => text, "Nothing found" by default
 * @param {string|Function} [props.createText]  or (query) => text, "Add "{value}"" by default
 * @param {Function} [props.isValidNew]      (query, values) => whether a typed value may be added
 * @param {Function} [props.normalize]       multiple: (entry) => the form two entries are compared in
 * @param {Object}   [props.commitRef]       multiple and creatable: its current is set to () => refused parts, which
 *                                           adds the typed text as values (as Enter does) for a save
 * @param {Function} [props.onQueryChange]   multiple: (text) after the typed text changed
 * @param {boolean}  [props.invalid]
 * @param {string}   [props.describedBy]
 * @param {Function} [props.onBlur]
 * @param {string}   [props.name]            a hidden input with the value (comma separated with multiple)
 * @param {*}        [props.ref]             the button or the input (react-hook-form focuses it)
 * @param {string}   [props.className]       of the wrapper
 */
export function Combobox({
	id,
	ref,
	value,
	onChange,
	options = [],
	multiple = false,
	creatable = false,
	clearable = false,
	searchable = true,
	loading = false,
	placeholder,
	disabled = false,
	readOnly = false,
	renderOption,
	getOptionLabel = defaultLabel,
	getOptionValue = defaultValue,
	emptyText,
	createText,
	isValidNew,
	normalize = defaultNormalize,
	commitRef,
	onQueryChange,
	invalid,
	describedBy,
	onBlur,
	name,
	className,
	...rest
}) {
	const ownId = useId();
	// the control itself, for focusing it after a chip is removed; ref also goes to the caller (react-hook-form)
	const focusRef = useRef(null);
	const inputRef = useCallback(
		(node) => {
			focusRef.current = node;
			if (typeof ref === "function") ref(node);
			else if (ref) ref.current = node;
		},
		[ref],
	);
	const aria = {
		...rest,
		"aria-invalid": invalid ? "true" : rest["aria-invalid"],
		"aria-describedby": joinIds(rest["aria-describedby"], describedBy),
	};
	const shared = {
		id: id ?? ownId,
		inputRef,
		focusRef,
		onChange,
		options,
		creatable,
		placeholder,
		disabled,
		readOnly,
		loading,
		renderOption,
		getOptionLabel,
		getOptionValue,
		emptyText,
		createText,
		isValidNew,
		onBlur,
		aria,
		className,
	};
	const hidden = multiple ? (Array.isArray(value) ? value.join(",") : "") : isEmptyValue(value) ? "" : String(value);
	return (
		<>
			{multiple ? (
				<MultipleCombobox
					{...shared}
					value={value}
					normalize={normalize}
					commitRef={commitRef}
					onQueryChange={onQueryChange}
				/>
			) : (
				<SingleCombobox {...shared} value={value} clearable={clearable} searchable={searchable} />
			)}
			{name ? <input type="hidden" name={name} value={hidden} /> : null}
		</>
	);
}
