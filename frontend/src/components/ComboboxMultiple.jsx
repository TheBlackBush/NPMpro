import { Command as CommandRoot, useCommandState } from "cmdk";
import { XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { TapTooltip } from "src/components/TapTooltip";
import { TruncatedText } from "src/components/TruncatedText";
import { Badge } from "src/components/ui/badge";
import { Button } from "src/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "src/components/ui/popover";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { addEntries, partitionEntries, removeLast } from "src/modules/Combobox";
import { ComboboxItems, keepScroll, LIST_TEXT, labelOf, listFor, popoverClass, useElementId } from "./ComboboxParts";

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
export function MultipleCombobox({
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
		// keys that confirm an input method's composition (Enter, a comma in Japanese or Chinese) are not ours
		if (locked || event.nativeEvent.isComposing || event.keyCode === 229) return;
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
									<TruncatedText>{label}</TruncatedText>
									{locked ? null : (
										<TapTooltip
											content={intl.formatMessage({ id: "combobox.remove" }, { value: label })}
											tap={false}
										>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												className="size-6 rounded-full"
												data-window-start-skip=""
												aria-label={intl.formatMessage(
													{ id: "combobox.remove" },
													{ value: label },
												)}
												onClick={() => remove(index)}
											>
												<XIcon aria-hidden="true" />
											</Button>
										</TapTooltip>
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
