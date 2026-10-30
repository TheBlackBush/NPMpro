import { useFormContext } from "react-hook-form";
import { intl, T } from "src/locale";

/**
 * The group of a host: a text field with the groups already used as suggestions
 */
export function DirectoryField({
	labelId,
	datalistId,
	name = "npmproDirectory",
	suggestions,
	placeholder = intl.formatMessage({ id: "form.example" }, { example: "Production, Staging" }),
}) {
	const { register } = useFormContext();
	return (
		<div>
			<label className="form-label" htmlFor={name}>
				<T id={labelId} />
			</label>
			<input
				id={name}
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
		</div>
	);
}
