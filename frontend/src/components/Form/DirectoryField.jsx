import { useFormContext } from "react-hook-form";
import { intl, T } from "src/locale";
import { FormField } from "./FormField";

/**
 * The group of a host, on the Details tab (UX-03): a text field with the groups already used as suggestions
 */
export function DirectoryField({
	labelId,
	datalistId,
	name = "npmproDirectory",
	suggestions,
	placeholder = intl.formatMessage({ id: "form.example" }, { example: "Production, Staging" }),
	className,
}) {
	const { register } = useFormContext();
	return (
		<FormField id={name} label={<T id={labelId} />} className={className}>
			{(control) => (
				<>
					<input
						{...control}
						type="text"
						className="form-control"
						maxLength={255}
						placeholder={placeholder}
						list={datalistId}
						{...register(name)}
					/>
					<datalist id={datalistId}>
						{suggestions.map((dir) => (
							<option key={dir} value={dir} />
						))}
					</datalist>
				</>
			)}
		</FormField>
	);
}
