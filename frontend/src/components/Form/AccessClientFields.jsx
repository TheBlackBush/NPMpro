import cn from "clsx";
import { PlusIcon, XIcon } from "lucide-react";
import { useFieldArray, useFormContext, useFormState, useWatch } from "react-hook-form";
import { Button, DESTRUCTIVE_TEXT } from "src/components/Button";
import { Input } from "src/components/ui/input";
import { NativeSelect } from "src/components/ui/native-select";
import { intl, T } from "src/locale";
import { blankRule } from "src/modules/AccessListForms";
import { FieldMessage } from "./FieldMessage";
import { useListRecheck, useRecheckDependent } from "./HookForm";

// allow on a success tint, deny on a warning tint
const directiveClass = (directive) =>
	cn(
		"w-auto shrink-0 [&_select]:text-foreground",
		directive === "allow" ? "[&_select]:bg-success/10" : "[&_select]:bg-warning/10",
	);

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
		<div className="flex items-start gap-2">
			<NativeSelect
				className={directiveClass(directive)}
				aria-label={intl.formatMessage({ id: "access-list.directive" })}
				{...register(`${base}.directive`)}
			>
				<DirectiveOptions />
			</NativeSelect>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<Input
					type="text"
					{...register(`${base}.address`, { onChange: onAddressChange })}
					autoComplete="off"
					aria-label={intl.formatMessage({ id: "access-list.address" })}
					aria-invalid={error ? "true" : undefined}
					aria-describedby={error ? `${name}-${index}-address-error` : undefined}
					placeholder={intl.formatMessage({
						id: "access-list.rule-source.placeholder",
					})}
				/>
				{error ? <FieldMessage id={`${name}-${index}-address-error`}>{error}</FieldMessage> : null}
			</div>
			<Button
				variant="ghost"
				className={DESTRUCTIVE_TEXT}
				size="icon"
				aria-label={intl.formatMessage({ id: "aria.remove" })}
				onClick={onRemove}
			>
				<XIcon aria-hidden="true" />
			</Button>
		</div>
	);
}

// the last rule: its address is always "all", only allow or deny can change
function LastRule({ name, index }) {
	const { register } = useFormContext();
	const directive = useWatch({ name: `${name}.${index}.directive` });
	return (
		<div className="flex flex-col gap-2">
			<p className="text-muted-foreground text-sm">
				<T id="access-list.help.rules-last" />
			</p>
			<div className="flex items-center gap-2">
				<NativeSelect
					className={directiveClass(directive)}
					aria-label={intl.formatMessage({ id: "access-list.directive" })}
					{...register(`${name}.${index}.directive`)}
				>
					<DirectiveOptions />
				</NativeSelect>
				<Input
					name="clients[last].address"
					type="text"
					aria-label={intl.formatMessage({ id: "access-list.address" })}
					autoComplete="off"
					value="all"
					disabled
				/>
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
		<div className="flex flex-col gap-3">
			<p className="text-muted-foreground text-sm">
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
			<Button className="self-start" size="sm" onClick={() => insert(last, blankRule(), { shouldFocus: false })}>
				<PlusIcon data-icon="inline-start" aria-hidden="true" />
				<T id="action.add" />
			</Button>
			<LastRule key={fields[last].id} name={name} index={last} />
		</div>
	);
}
