import { useController } from "react-hook-form";
import { Combobox } from "src/components/Combobox";
import { useTagSuggestions } from "src/hooks";
import { intl, T } from "src/locale";
import { LINE_ENTRIES } from "src/modules/Combobox";
import { isValidTag, TAGS_MAX, tagInputMessage, tagOptions } from "src/modules/HostTags";
import { FormField } from "./FormField";
import { usePendingEntry, useReadOnly } from "./HookForm";

const refusedMessage = (refused) => intl.formatMessage({ id: "error.tag-invalid" }, { tag: refused.join(", ") });

/**
 * The tags of a host, on the Details tab next to Group: chips with a text input (the app's combobox, as Domain
 * Names). Typing filters the tags already used on any host type, Enter or a comma adds the typed tag (spaces stay in
 * it), the chip's x removes one. Text typed without Enter is added on save, an invalid one refuses the save.
 */
export function TagsField({ name = "npmproTags", className }) {
	const { field, fieldState } = useController({ name });
	const pending = usePendingEntry(name, refusedMessage);
	const readOnly = useReadOnly();
	const used = useTagSuggestions();
	const values = field.value ?? [];
	return (
		<FormField
			id={name}
			label={<T id="host.tags" />}
			className={className}
			error={fieldState.error?.message ?? null}
		>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name={name}
					multiple
					creatable
					separators={LINE_ENTRIES}
					disabled={readOnly}
					options={tagOptions(used, values)}
					value={values}
					isValidNew={(input, current) => isValidTag(input) && current.length < TAGS_MAX}
					createText={(input) => intl.formatMessage({ id: "host.tags.create" }, { name: input.trim() })}
					emptyText={(input) => {
						const { id, values: data } = tagInputMessage(input, values.length);
						return intl.formatMessage({ id }, data);
					}}
					commitRef={pending.ref}
					onQueryChange={(text) => pending.setPending(text.trim() !== "")}
					placeholder={intl.formatMessage({ id: "host.tags.placeholder" })}
					onBlur={field.onBlur}
					onChange={(tags) => field.onChange(tags)}
				/>
			)}
		</FormField>
	);
}
