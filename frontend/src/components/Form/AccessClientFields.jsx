import { IconX } from "@tabler/icons-react";
import cn from "clsx";
import { useField, useFormikContext } from "formik";
import { useRef, useState } from "react";
import { intl, T } from "src/locale";
import { visibleErrorAt } from "src/modules/FormFields";

// the backend's rule (schema/common.json): an address or CIDR range, or unix:; "all" is only the last rule
const ADDRESS = /^(?:unix:|[0-9A-Fa-f.:/]{1,255})$/u;

/**
 * The errors of the rules before the last ("all") one, one object per row, or undefined
 */
const clientErrors = (rows) => {
	const errors = rows.slice(0, -1).map((row) => {
		const address = String(row.address ?? "").trim();
		return address === "" || ADDRESS.test(address)
			? undefined
			: { address: intl.formatMessage({ id: "access-list.address.invalid" }) };
	});
	return errors.some(Boolean) ? errors : undefined;
};

export function AccessClientFields({ initialValues, name = "clients" }) {
	const [values, setValues] = useState(
		initialValues.at(-1)?.address?.toLowerCase() === "all"
			? initialValues
			: [...initialValues, { directive: "deny", address: "all" }],
	);
	const { setFieldValue, setFieldTouched, errors, touched, submitCount } = useFormikContext();
	// the Formik value leaves out rows without an address, so the rows are checked here
	const rowsRef = useRef(values);
	rowsRef.current = values;
	useField({ name, validate: () => clientErrors(rowsRef.current) });
	const shownError = (idx) => visibleErrorAt({ errors, touched, submitCount }, `${name}[${idx}].address`);

	const blankClient = { directive: "allow", address: "" };

	if (values?.length === 1) {
		setValues([blankClient, ...values]);
	}

	const handleAdd = () => {
		setValues(values.toSpliced(values.length - 1, 0, blankClient));
	};

	const handleRemove = (idx) => {
		const newValues = values.toSpliced(idx, 1);
		setValues(newValues);
		void setFieldTouched(name, undefined, false);
		setFormField(newValues);
	};

	const handleChange = (idx, field, fieldValue) => {
		const newValues = values.with(idx, { ...values[idx], [field]: fieldValue });
		setValues(newValues);
		void setFieldTouched(`${name}[${idx}].${field}`, true, false);
		setFormField(newValues);
	};

	const setFormField = (newValues) => {
		rowsRef.current = newValues;
		const filtered = newValues.filter((v) => v?.address?.trim() !== "");
		void setFieldValue(name, filtered);
	};

	return (
		<>
			<p className="text-secondary">
				<T id="access-list.help.rules-order" />
			</p>
			{values.slice(0, -1).map((client, idx) => (
				<div className="row mb-1" key={idx}>
					<div className="col-11">
						<div className="input-group mb-2">
							<select
								className={cn(
									"form-select",
									"w-auto",
									"flex-grow-0",
									client.directive === "allow" ? "bg-lime-lt" : "bg-orange-lt",
								)}
								name={`clients[${idx}].directive`}
								value={client.directive}
								onChange={(e) => handleChange(idx, "directive", e.target.value)}
							>
								<option value="allow">
									<T id="action.allow" />
								</option>
								<option value="deny">
									<T id="action.deny" />
								</option>
							</select>
							<input
								name={`${name}[${idx}].address`}
								type="text"
								className={cn("form-control", shownError(idx) && "is-invalid")}
								autoComplete="off"
								aria-label={intl.formatMessage({ id: "access-list.address" })}
								aria-invalid={shownError(idx) ? "true" : undefined}
								value={client.address}
								onChange={(e) => handleChange(idx, "address", e.target.value)}
								placeholder={intl.formatMessage({
									id: "access-list.rule-source.placeholder",
								})}
							/>
							{shownError(idx) ? <div className="invalid-feedback">{shownError(idx)}</div> : null}
						</div>
					</div>
					<div className="col-1">
						<button
							type="button"
							className="btn btn-ghost btn-danger p-0"
							onClick={() => handleRemove(idx)}
						>
							<IconX size={16} />
						</button>
					</div>
				</div>
			))}
			<div className="mb-3">
				<button type="button" className="btn btn-sm" onClick={handleAdd}>
					<T id="action.add" />
				</button>
			</div>
			<div className="row mb-3">
				<p className="text-secondary">
					<T id="access-list.help.rules-last" />
				</p>
				<div className="col-11">
					<div className="input-group mb-2">
						<select
							className={cn(
								"form-select",
								"w-auto",
								"flex-grow-0",
								values[values.length - 1].directive === "allow" ? "bg-lime-lt" : "bg-orange-lt",
							)}
							name="clients[last].directive"
							value={values[values.length - 1].directive}
							onChange={(e) => handleChange(values.length - 1, "directive", e.target.value)}
						>
							<option value="allow">
								<T id="action.allow" />
							</option>
							<option value="deny">
								<T id="action.deny" />
							</option>
						</select>
						<input
							name="clients[last].address"
							type="text"
							className="form-control"
							autoComplete="off"
							value="all"
							disabled
						/>
					</div>
				</div>
			</div>
		</>
	);
}
