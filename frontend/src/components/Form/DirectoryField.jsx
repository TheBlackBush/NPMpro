import { useController } from "react-hook-form";
import CreatableSelect from "react-select/creatable";
import { useGroupSuggestions } from "src/hooks";
import { intl, T } from "src/locale";
import { GROUP_MAX_LENGTH, groupOption, isNewGroupName } from "src/modules/HostGroups";
import { selectClassNames } from "src/modules/Select";
import { FormField, selectControlProps } from "./FormField";
import { useReadOnly } from "./HookForm";

/**
 * The group of a host, on the Details tab (UX-03): the app's searchable dropdown (react-select, as Domain Names and
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
				<CreatableSelect
					{...selectControlProps(control)}
					ref={field.ref}
					unstyled
					classNames={selectClassNames}
					name={name}
					isClearable
					isDisabled={readOnly}
					options={groups.map(groupOption)}
					value={groupOption(field.value)}
					placeholder={placeholder}
					isValidNewOption={(input) => isNewGroupName(input, groups)}
					formatCreateLabel={(input) =>
						intl.formatMessage({ id: "host.group.create" }, { name: input.trim() })
					}
					noOptionsMessage={({ inputValue }) =>
						intl.formatMessage({
							id: inputValue.trim().length > GROUP_MAX_LENGTH ? "host.group.too-long" : "host.group.none",
						})
					}
					onBlur={field.onBlur}
					onChange={(option) => field.onChange(option ? option.value.trim() : "")}
				/>
			)}
		</FormField>
	);
}
