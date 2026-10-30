import { IconEye, IconEyeOff, IconX } from "@tabler/icons-react";
import cn from "clsx";
import { useField, useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import { intl, T } from "src/locale";
import { visibleErrorAt } from "src/modules/FormFields";

const blankItem = { username: "", password: "" };
// the backend's rules (schema/common.json, internal/access-list.js); bcrypt reads at most 72 bytes
const USERNAME = /^[^:\p{Cc}]{1,255}$/u;
const MAX_PASSWORD_BYTES = 72;

const message = (id, data) => intl.formatMessage({ id }, data);

/**
 * The errors of the rows (blank ones included), one object per row, or undefined
 */
const itemErrors = (rows, saved) => {
	const seen = new Set();
	const errors = rows.map((row) => {
		const error = {};
		const username = String(row.username ?? "").trim();
		if (username === "") return null;
		if (!USERNAME.test(username)) error.username = message("access-list.username.invalid");
		else if (seen.has(username)) error.username = message("error.access.duplicate-usernames");
		seen.add(username);
		const password = String(row.password ?? "");
		if (password === "" && !saved.has(username)) error.password = message("error.required");
		else if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
			error.password = message("error.max-byte-length", { max: MAX_PASSWORD_BYTES });
		}
		return Object.keys(error).length > 0 ? error : null;
	});
	return errors.some(Boolean) ? errors : undefined;
};

export function BasicAuthFields({ initialValues, name = "items" }) {
	const [values, setValues] = useState(initialValues);
	const [revealed, setRevealed] = useState([]);
	const { setFieldValue, setFieldTouched, errors, touched, submitCount } = useFormikContext();
	// the Formik value leaves out rows without a username, so the rows are checked here
	const rowsRef = useRef(values);
	const saved = new Set(initialValues.map((iv) => iv.username));
	useField({ name, validate: () => itemErrors(rowsRef.current, saved) });
	const shownError = (idx, field) => visibleErrorAt({ errors, touched, submitCount }, `${name}[${idx}].${field}`);

	useEffect(() => {
		if (values.length === 0) {
			setValues([blankItem]);
		}
	});

	const handleAdd = () => {
		setValues([...values, blankItem]);
	};

	const handleRemove = (idx) => {
		const newValues = values.filter((_, i) => i !== idx);
		setValues(newValues);
		setRevealed(revealed.toSpliced(idx, 1));
		void setFieldTouched(name, undefined, false);
		setFormField(newValues);
	};

	const handleChange = (idx, field, fieldValue) => {
		const newValues = values.map((v, i) => (i === idx ? { ...v, [field]: fieldValue } : v));
		setValues(newValues);
		void setFieldTouched(`${name}[${idx}].${field}`, true, false);
		setFormField(newValues);
	};

	const setFormField = (newValues) => {
		rowsRef.current = newValues;
		const filtered = newValues.filter((v) => v?.username?.trim() !== "");
		void setFieldValue(name, filtered);
	};

	return (
		<>
			<div className="row">
				<div className="col-6">
					<div className="form-label">
						<T id="username" />
					</div>
				</div>
				<div className="col-6">
					<div className="form-label">
						<T id="password" />
					</div>
				</div>
			</div>
			{values.map((item, idx) => (
				<div className="row mb-3" key={idx}>
					<div className="col-6">
						<input
							type="text"
							name={`${name}[${idx}].username`}
							autoComplete="off"
							className={cn("form-control input-sm", shownError(idx, "username") && "is-invalid")}
							aria-label={intl.formatMessage({ id: "username" })}
							aria-invalid={shownError(idx, "username") ? "true" : undefined}
							value={item.username}
							onChange={(e) => handleChange(idx, "username", e.target.value)}
						/>
						{shownError(idx, "username") ? (
							<div className="invalid-feedback">{shownError(idx, "username")}</div>
						) : null}
					</div>
					<div className="col-5">
						<div
							className={cn(
								"input-group input-group-flat",
								shownError(idx, "password") && "has-validation",
							)}
						>
							<input
								type={revealed[idx] ? "text" : "password"}
								name={`${name}[${idx}].password`}
								autoComplete="new-password"
								className={cn("form-control", shownError(idx, "password") && "is-invalid")}
								aria-label={intl.formatMessage({ id: "password" })}
								aria-invalid={shownError(idx, "password") ? "true" : undefined}
								required={
									item.username.trim() !== "" &&
									!initialValues.some((iv) => iv.username === item.username)
								}
								value={item.password}
								placeholder={
									initialValues.some((iv) => iv.username === item.username) ? "••••••••" : ""
								}
								onChange={(e) => handleChange(idx, "password", e.target.value)}
							/>

							<span className="input-group-text py-0">
								<button
									type="button"
									aria-label={intl.formatMessage({ id: "password.toggle-visibility" })}
									aria-pressed={Boolean(revealed[idx])}
									className="btn btn-icon btn-ghost btn-sm"
									onClick={() => setRevealed((r) => Object.assign([...r], { [idx]: !r[idx] }))}
								>
									{revealed[idx] ? (
										<IconEyeOff className="icon" aria-hidden="true" />
									) : (
										<IconEye className="icon" aria-hidden="true" />
									)}
								</button>
							</span>
							{shownError(idx, "password") ? (
								<div className="invalid-feedback">{shownError(idx, "password")}</div>
							) : null}
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
			<div>
				<button type="button" className="btn btn-sm" onClick={handleAdd}>
					<T id="action.add" />
				</button>
			</div>
		</>
	);
}
