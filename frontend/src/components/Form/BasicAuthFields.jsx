import { IconEye, IconEyeOff, IconX } from "@tabler/icons-react";
import cn from "clsx";
import { useState } from "react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
import { blankUser } from "src/modules/AccessListForms";
import { useListRecheck, useRecheckDependent } from "./HookForm";

// one user: a new name re-checks its password (a saved user may keep it), the other rows' names (duplicates) and
// the "at least one user or rule" message
function UserRow({ name, index, savedUsers, revealed, onToggleReveal, onRemove, recheckRows, recheckAccessRules }) {
	const { register, getFieldState } = useFormContext();
	const base = `${name}.${index}`;
	const formState = useFormState({ name: base });
	const username = useWatch({ name: `${base}.username` }) ?? "";
	const recheckPassword = useRecheckDependent(`${base}.password`);
	const usernameError = getFieldState(`${base}.username`, formState).error?.message ?? null;
	const passwordError = getFieldState(`${base}.password`, formState).error?.message ?? null;
	const saved = savedUsers.has(username);
	return (
		<div className="row mb-3">
			<div className="col-6">
				<input
					type="text"
					{...register(`${base}.username`, {
						onChange: () => {
							recheckPassword();
							recheckRows("username");
							recheckAccessRules();
						},
					})}
					autoComplete="off"
					className={cn("form-control input-sm", usernameError && "is-invalid")}
					aria-label={intl.formatMessage({ id: "username" })}
					aria-invalid={usernameError ? "true" : undefined}
				/>
				{usernameError ? <div className="invalid-feedback">{usernameError}</div> : null}
			</div>
			<div className="col-5">
				<div className={cn("input-group input-group-flat", passwordError && "has-validation")}>
					<input
						type={revealed ? "text" : "password"}
						{...register(`${base}.password`)}
						autoComplete="new-password"
						className={cn("form-control", passwordError && "is-invalid")}
						aria-label={intl.formatMessage({ id: "password" })}
						aria-invalid={passwordError ? "true" : undefined}
						required={username.trim() !== "" && !saved}
						placeholder={saved ? "••••••••" : ""}
					/>

					<span className="input-group-text py-0">
						<button
							type="button"
							aria-label={intl.formatMessage({ id: "password.toggle-visibility" })}
							aria-pressed={revealed}
							className="btn btn-icon btn-ghost btn-sm"
							onClick={onToggleReveal}
						>
							{revealed ? (
								<IconEyeOff className="icon" aria-hidden="true" />
							) : (
								<IconEye className="icon" aria-hidden="true" />
							)}
						</button>
					</span>
					{passwordError ? <div className="invalid-feedback">{passwordError}</div> : null}
				</div>
			</div>
			<div className="col-1">
				<button type="button" className="btn btn-ghost btn-danger p-0" onClick={onRemove}>
					<IconX size={16} />
				</button>
			</div>
		</div>
	);
}

/**
 * The basic auth users of an access list (useFieldArray over the form's items): always at least one row, a blank row
 * is not sent (AccessListForms.js)
 *
 * @param {Object}      props
 * @param {Set<string>} props.savedUsers  the usernames of the saved list (their password may stay empty)
 * @param {string}      [props.name]
 */
export function BasicAuthFields({ savedUsers, name = "items" }) {
	const { fields, append, remove, update } = useFieldArray({ name });
	const [revealed, setRevealed] = useState([]);
	const { afterRemove, recheckRows } = useListRecheck(name);
	const recheckAccessRules = useRecheckDependent("accessRules");

	const handleRemove = (index) => {
		// the only row is emptied instead, as there is always one
		if (fields.length === 1) update(index, blankUser());
		else remove(index);
		afterRemove();
		recheckAccessRules();
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
			{fields.map((field, index) => (
				<UserRow
					key={field.id}
					name={name}
					index={index}
					savedUsers={savedUsers}
					revealed={revealed.includes(field.id)}
					onToggleReveal={() =>
						setRevealed((list) =>
							list.includes(field.id) ? list.filter((id) => id !== field.id) : [...list, field.id],
						)
					}
					onRemove={() => handleRemove(index)}
					recheckRows={recheckRows}
					recheckAccessRules={recheckAccessRules}
				/>
			))}
			<div>
				<button
					type="button"
					className="btn btn-sm"
					onClick={() => append(blankUser(), { shouldFocus: false })}
				>
					<T id="action.add" />
				</button>
			</div>
		</>
	);
}
