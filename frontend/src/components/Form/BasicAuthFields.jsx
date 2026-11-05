import { PlusIcon, XIcon } from "lucide-react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { Button, DESTRUCTIVE_TEXT } from "src/components/Button";
import { FieldLabel } from "src/components/ui/field";
import { Input } from "src/components/ui/input";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { blankUser } from "src/modules/AccessListForms";
import { FieldMessage } from "./FieldMessage";
import { useListRecheck, useRecheckDependent } from "./HookForm";
import { PasswordControl } from "./PasswordInput";

// username, password and the remove button: a grid with the remove button beside the two fields on phones (stacked),
// all three in a row from sm
const ROW = "grid grid-cols-[1fr_auto] items-start gap-x-2 gap-y-2 sm:grid-cols-[1fr_1fr_auto]";

// one user: a new name re-checks its password (a saved user may keep it), the other rows' names (duplicates) and
// the "at least one user or rule" message. The column headings of the list label the fields from sm; on phones
// each row names its own fields.
function UserRow({ name, index, rowKey, savedUsers, onRemove, recheckRows, recheckAccessRules }) {
	const { register, getFieldState } = useFormContext();
	const base = `${name}.${index}`;
	const formState = useFormState({ name: base });
	const username = useWatch({ name: `${base}.username` }) ?? "";
	const recheckPassword = useRecheckDependent(`${base}.password`);
	const usernameError = getFieldState(`${base}.username`, formState).error?.message ?? null;
	const passwordError = getFieldState(`${base}.password`, formState).error?.message ?? null;
	const saved = savedUsers.has(username);
	const usernameId = `basicAuthUsername-${rowKey}`;
	const passwordId = `basicAuthPassword-${rowKey}`;
	return (
		<div className={ROW}>
			<div className="flex min-w-0 flex-col gap-1 sm:col-start-1">
				<FieldLabel htmlFor={usernameId} className="sm:sr-only">
					<T id="username" />
				</FieldLabel>
				<Input
					id={usernameId}
					type="text"
					{...register(`${base}.username`, {
						onChange: () => {
							recheckPassword();
							recheckRows("username");
							recheckAccessRules();
						},
					})}
					autoComplete="off"
					aria-invalid={usernameError ? "true" : undefined}
					aria-describedby={usernameError ? `${usernameId}-error` : undefined}
				/>
				{usernameError ? <FieldMessage id={`${usernameId}-error`}>{usernameError}</FieldMessage> : null}
			</div>
			<div className="flex min-w-0 flex-col gap-1 sm:col-start-2 sm:row-start-1">
				<FieldLabel htmlFor={passwordId} className="sm:sr-only">
					<T id="password" />
				</FieldLabel>
				<PasswordControl
					id={passwordId}
					{...register(`${base}.password`)}
					autoComplete="new-password"
					invalid={Boolean(passwordError)}
					aria-describedby={passwordError ? `${passwordId}-error` : undefined}
					required={username.trim() !== "" && !saved}
					placeholder={saved ? "••••••••" : ""}
				/>
				{passwordError ? <FieldMessage id={`${passwordId}-error`}>{passwordError}</FieldMessage> : null}
			</div>
			<Button
				variant="ghost"
				className={cn(
					"row-span-2 self-center sm:col-start-3 sm:row-span-1 sm:row-start-1 sm:self-start",
					DESTRUCTIVE_TEXT,
				)}
				size="icon"
				aria-label={intl.formatMessage({ id: "aria.remove" })}
				onClick={onRemove}
			>
				<XIcon aria-hidden="true" />
			</Button>
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
		<div className="flex flex-col gap-3">
			<div className="hidden gap-x-2 font-medium text-sm sm:grid sm:grid-cols-[1fr_1fr_auto]" aria-hidden="true">
				<div>
					<T id="username" />
				</div>
				<div>
					<T id="password" />
				</div>
			</div>
			{fields.map((field, index) => (
				<UserRow
					key={field.id}
					name={name}
					index={index}
					rowKey={field.id}
					savedUsers={savedUsers}
					onRemove={() => handleRemove(index)}
					recheckRows={recheckRows}
					recheckAccessRules={recheckAccessRules}
				/>
			))}
			<Button className="self-start" size="sm" onClick={() => append(blankUser(), { shouldFocus: false })}>
				<PlusIcon data-icon="inline-start" aria-hidden="true" />
				<T id="action.add" />
			</Button>
		</div>
	);
}
