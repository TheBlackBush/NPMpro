import { useCallback, useState } from "react";
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from "src/components/ui/command";
import { intl } from "src/locale";
import { canCreate, exactFirst, filterOptions, groupsOf, orderKeys } from "src/modules/Combobox";

// the cmdk value of the "Add ..." item; option items are "o:" and their value
export const CREATE_KEY = "create:";
export const optionKey = (value) => `o:${String(value)}`;

export const defaultLabel = (option) => option?.label;
export const defaultValue = (option) => option?.value;
export const defaultNormalize = (entry) => String(entry).trim().toLowerCase();

// a text prop that may depend on the query: a string, or (query) => string
export const textFor = (text, query) => (typeof text === "function" ? text(query) : text);

// The window around a combobox (a Radix Dialog or Sheet) locks scrolling outside itself, and the list is portalled out
// of it: wheel and touch scrolling of the list must not reach the window's document listener, or it is cancelled
export const keepScroll = {
	onWheel: (event) => event.stopPropagation(),
	onTouchMove: (event) => event.stopPropagation(),
};

export const popoverClass = "w-(--radix-popover-trigger-width) min-w-48 gap-0 p-0";

// the label of a value: its option's label, or the value itself (a typed one, or one the options do not list)
export function labelOf(value, options, getOptionLabel, getOptionValue) {
	const option = options.find((o) => getOptionValue(o) === value);
	return option ? getOptionLabel(option) : String(value);
}

/**
 * The options a query shows and the "Add ..." entry, shared by both modes
 *
 * @returns {{ items: Object[], createLabel: string|null, keys: string[] }}
 */
export function listFor({
	options,
	query,
	values,
	multiple,
	creatable,
	isValidNew,
	getOptionLabel,
	getOptionValue,
	createText,
	filter = true,
	createFirst = false,
}) {
	const chosen = new Set(values.map(String));
	// a multiple field does not offer what it already holds
	const pool = multiple ? options.filter((option) => !chosen.has(String(getOptionValue(option)))) : options;
	const trimmed = query.trim();
	const labels = values.map((value) => labelOf(value, options, getOptionLabel, getOptionValue));
	const offer =
		creatable &&
		canCreate(trimmed, options, multiple ? labels : [], getOptionLabel) &&
		// the value too: the ASCII form of a Unicode label is the same name
		canCreate(trimmed, options, [], getOptionValue) &&
		(isValidNew ? isValidNew(trimmed, values) : true);
	const createLabel = offer
		? (textFor(createText, trimmed) ?? intl.formatMessage({ id: "combobox.create" }, { value: trimmed }))
		: null;
	// filter false: the options already answer the query; an option that is exactly the typed text leads when
	// "Add ..." leads, so Enter takes the typed text
	const matching = filter ? filterOptions(pool, query, getOptionLabel) : pool;
	const items =
		createFirst && !filter && !createLabel
			? exactFirst(matching, trimmed, getOptionLabel, getOptionValue)
			: matching;
	const keys = orderKeys({
		itemKeys: items.filter((option) => !option.disabled).map((option) => optionKey(getOptionValue(option))),
		createKey: createLabel ? CREATE_KEY : null,
		createFirst,
	});
	return { items, createLabel, keys };
}

/**
 * The listbox: the options (rich rows through renderOption), "Add ...", and the empty or loading text
 */
export function ComboboxItems({
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
	createFirst = false,
}) {
	const createItem = list.createLabel ? (
		<CommandItem value={CREATE_KEY} onSelect={onCreate}>
			<span className="min-w-0 flex-1 break-all">{list.createLabel}</span>
		</CommandItem>
	) : null;
	const renderItem = (option) => {
		const key = optionKey(getOptionValue(option));
		return (
			<CommandItem
				key={key}
				value={key}
				disabled={Boolean(option.disabled)}
				data-checked={key === selectedKey}
				onSelect={() => onPick(option)}
			>
				<div className="min-w-0 flex-1">{renderOption ? renderOption(option) : getOptionLabel(option)}</div>
			</CommandItem>
		);
	};
	return (
		<CommandList ref={listRef} label={intl.formatMessage({ id: "combobox.options" })}>
			<CommandEmpty className="py-4">
				{loading
					? intl.formatMessage({ id: "loading" })
					: (textFor(emptyText, query.trim()) ?? intl.formatMessage({ id: "combobox.empty" }))}
			</CommandEmpty>
			{list.items.length > 0 || list.createLabel ? (
				<div className="p-1">
					{createFirst ? createItem : null}
					{groupsOf(list.items).map((group, index) =>
						group.label ? (
							<CommandGroup key={`g:${index}:${group.label}`} heading={group.label} className="p-0">
								{group.items.map(renderItem)}
							</CommandGroup>
						) : (
							group.items.map(renderItem)
						),
					)}
					{createFirst ? null : createItem}
				</div>
			) : null}
		</CommandList>
	);
}

// the id of a mounted element, kept in state by a callback ref (the listbox, for aria-controls)
export function useElementId() {
	const [element, setElement] = useState(null);
	const ref = useCallback((node) => setElement(node), []);
	return [element, ref];
}
