import { useController } from "react-hook-form";
import { Combobox } from "src/components/Combobox";
import { useGroupSuggestions } from "src/hooks";
import { intl, T } from "src/locale";
import { GROUP_MAX_LENGTH, groupOption, isNewGroupName } from "src/modules/HostGroups";
import { FormField } from "./FormField";
import { useReadOnly } from "./HookForm";

/**
 * The group of a host, on the Details tab (UX-03): the app's searchable dropdown (the combobox, as Domain Names and
 * the access lists). Its arrow lists the groups already used by any host type, typing filters them, a new name is
 * offered as "Create ...", the clear button (or Backspace) leaves the host without a group. The field holds the name
 * as text ("" for no group), as the text input did; disabled in a View window.
 */
export function DirectoryField({
	labelId,
	name = "npmproDirectory",
	placeholder = intl.formatMessage({ id: "form.example" }, { example: "Production, Staging" }),
	className,
}) {
	const { field } = useController({ name });
	const readOnly = useReadOnly();
	const groups = useGroupSuggestions();
	return (
		<FormField id={name} label={<T id={labelId} />} className={className}>
			{(control) => (
				<Combobox
					{...control}
					ref={field.ref}
					name={name}
					creatable
					clearable
					disabled={readOnly}
					options={groups.map(groupOption)}
					value={field.value || null}
					placeholder={placeholder}
					isValidNew={(input) => isNewGroupName(input, groups)}
					createText={(input) => intl.formatMessage({ id: "host.group.create" }, { name: input.trim() })}
					emptyText={(input) =>
						intl.formatMessage({
							id: input.trim().length > GROUP_MAX_LENGTH ? "host.group.too-long" : "host.group.none",
						})
					}
					onBlur={field.onBlur}
					onChange={(value) => field.onChange(value ? value.trim() : "")}
				/>
			)}
		</FormField>
	);
}
