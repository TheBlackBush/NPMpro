import { Field } from "formik";
import { useFormContext } from "react-hook-form";
import { intl, T } from "src/locale";

// in a React Hook Form form: the text field registered under name
function HookFormDirectoryField({ labelId, datalistId, name, suggestions, placeholder }) {
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

// in a Formik form (the proxy host window until Task 8)
function FormikDirectoryField({ labelId, datalistId, name, suggestions, placeholder }) {
	return (
		<Field name={name}>
			{({ field }) => (
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
						{...field}
					/>

					<datalist id={datalistId}>
						{suggestions.map((dir) => (
							<option key={dir} value={dir} />
						))}
					</datalist>
				</div>
			)}
		</Field>
	);
}

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
	const props = { labelId, datalistId, name, suggestions, placeholder };
	// Task 8 removes the Formik branch
	return useFormContext() ? <HookFormDirectoryField {...props} /> : <FormikDirectoryField {...props} />;
}
