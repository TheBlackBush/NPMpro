import { ChevronsUpDownIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "src/components/ui/button";
import { Command, CommandInput } from "src/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "src/components/ui/popover";
import { cn } from "src/lib/utils";
import { intl } from "src/locale";
import { isEmptyValue } from "src/modules/Combobox";
import { ComboboxItems, keepScroll, listFor, optionKey, popoverClass, useElementId } from "./ComboboxParts";

/**
 * One value from a list: a button that opens the list, with a search box (unless searchable is false)
 */
export function SingleCombobox({
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
						data-window-start-skip=""
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
