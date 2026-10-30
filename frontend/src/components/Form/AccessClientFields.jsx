import { IconX } from "@tabler/icons-react";
import cn from "clsx";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
import { blankRule } from "src/modules/AccessListForms";
import { useListRecheck, useRecheckDependent } from "./HookForm";

// allow on a lime background, deny on orange
const directiveClass = (directive) =>
	cn("form-select", "w-auto", "flex-grow-0", directive === "allow" ? "bg-lime-lt" : "bg-orange-lt");

function DirectiveOptions() {
	return (
		<>
			<option value="allow">
				<T id="action.allow" />
			</option>
			<option value="deny">
				<T id="action.deny" />
			</option>
		</>
	);
}

// one rule before the last one: allow or deny, and an address (a new address re-checks "at least one rule")
function RuleRow({ name, index, onRemove, onAddressChange }) {
	const { register, getFieldState } = useFormContext();
	const base = `${name}.${index}`;
	const formState = useFormState({ name: `${base}.address` });
	const directive = useWatch({ name: `${base}.directive` });
	const error = getFieldState(`${base}.address`, formState).error?.message ?? null;
	return (
		<div className="row mb-1">
			<div className="col-11">
				<div className="input-group mb-2">
					<select className={directiveClass(directive)} {...register(`${base}.directive`)}>
						<DirectiveOptions />
					</select>
					<input
						type="text"
						{...register(`${base}.address`, { onChange: onAddressChange })}
						className={cn("form-control", error && "is-invalid")}
						autoComplete="off"
						aria-label={intl.formatMessage({ id: "access-list.address" })}
						aria-invalid={error ? "true" : undefined}
						placeholder={intl.formatMessage({
							id: "access-list.rule-source.placeholder",
						})}
					/>
					{error ? <div className="invalid-feedback">{error}</div> : null}
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

// the last rule: its address is always "all", only allow or deny can change
function LastRule({ name, index }) {
	const { register } = useFormContext();
	const directive = useWatch({ name: `${name}.${index}.directive` });
	return (
		<div className="row mb-3">
			<p className="text-secondary">
				<T id="access-list.help.rules-last" />
			</p>
			<div className="col-11">
				<div className="input-group mb-2">
					<select className={directiveClass(directive)} {...register(`${name}.${index}.directive`)}>
						<DirectiveOptions />
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
	);
}

/**
 * The access rules of an access list (useFieldArray over the form's clients): the rules in order, then the last
 * "all" rule; always at least one rule before it, a rule without an address is not sent (AccessListForms.js)
 *
 * @param {Object} props
 * @param {string} [props.name]
 */
export function AccessClientFields({ name = "clients" }) {
	const { fields, insert, remove, update } = useFieldArray({ name });
	const { afterRemove } = useListRecheck(name);
	const recheckAccessRules = useRecheckDependent("accessRules");
	const last = fields.length - 1;

	const handleRemove = (index) => {
		// the only rule before "all" is emptied instead, as there is always one
		if (last === 1) update(index, blankRule());
		else remove(index);
		afterRemove();
		recheckAccessRules();
	};

	return (
		<>
			<p className="text-secondary">
				<T id="access-list.help.rules-order" />
			</p>
			{fields.slice(0, -1).map((field, index) => (
				<RuleRow
					key={field.id}
					name={name}
					index={index}
					onRemove={() => handleRemove(index)}
					onAddressChange={recheckAccessRules}
				/>
			))}
			<div className="mb-3">
				<button
					type="button"
					className="btn btn-sm"
					onClick={() => insert(last, blankRule(), { shouldFocus: false })}
				>
					<T id="action.add" />
				</button>
			</div>
			<LastRule key={fields[last].id} name={name} index={last} />
		</>
	);
}
