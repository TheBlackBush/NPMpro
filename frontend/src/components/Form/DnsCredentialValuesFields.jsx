import { useController, useFormContext, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
import { ChoiceGroup } from "./ChoiceGroup";
import { PasswordField, TextField } from "./FormField";

// the rules of these fields are in modules/CertificateForms.js (dnsCredentialValidate), the window's resolver

const ENTRY_OPTIONS = [
	{ value: "fields", label: <T id="dns-credentials.entry.fields" /> },
	{ value: "ini", label: <T id="dns-credentials.entry.ini" /> },
];

// one field of the provider: a secret with the eye button, a URL, a number or text; a saved secret may stay empty
function ValueInput({ definition, saved }) {
	const props = {
		name: `fieldValues.${definition.key}`,
		id: `dnsCredentialField-${definition.key}`,
		label: definition.label,
		required: !definition.optional && !saved,
		autoComplete: "off",
		placeholder: saved ? intl.formatMessage({ id: "dns-credentials.saved-keep" }) : definition.placeholder,
	};
	if (definition.type === "secret") return <PasswordField {...props} />;
	const type = definition.type === "url" || definition.type === "number" ? definition.type : "text";
	return <TextField {...props} type={type} />;
}

// the INI text, required unless one is saved
function IniInput({ provider, credential }) {
	return (
		<TextField
			name="ini"
			id="dnsCredentialIni"
			as="textarea"
			label={<T id="dns-credentials.ini" />}
			required={!credential?.iniSet}
			hint={credential?.iniSet ? <T id="dns-credentials.saved-keep" /> : undefined}
			controlClassName="font-monospace"
			spellCheck={false}
			rows={6}
			placeholder={provider.credentials}
		/>
	);
}

// Fields or INI text, for a provider with field definitions; the hidden side's messages go
function EntryChoice() {
	const { clearErrors } = useFormContext();
	const { field } = useController({ name: "useIni" });
	return (
		<ChoiceGroup
			name="useIni"
			legend={<T id="dns-credentials.entry" />}
			variant="pills"
			value={field.value ? "ini" : "fields"}
			inputRef={field.ref}
			onBlur={field.onBlur}
			options={ENTRY_OPTIONS}
			onChange={(value) => {
				field.onChange(value === "ini");
				clearErrors(value === "ini" ? "fieldValues" : "ini");
			}}
		/>
	);
}

/**
 * The credential values of a provider (the fields of the form around it): Fields or INI text when the provider has
 * field definitions, then the INI text or the fields (with the choice of a group when the provider takes one of
 * several sets)
 */
export function DnsCredentialValuesFields({ provider, credential }) {
	const { setValue, clearErrors } = useFormContext();
	const [useIni, oneOfGroup] = useWatch({ name: ["useIni", "oneOfGroup"] });
	if (!provider) {
		return null;
	}

	const entry = provider.fields ? <EntryChoice /> : null;

	if (!provider.fields || useIni) {
		return (
			<>
				{entry}
				<IniInput provider={provider} credential={credential} />
			</>
		);
	}

	const savedKeys = new Set((credential?.fields ?? []).filter((f) => f.isSet).map((f) => f.key));
	const groups = provider.oneOf ?? [];
	const groupLabel = (group) =>
		provider.fields
			.filter((f) => f.group === group)
			.map((f) => f.label)
			.join(" + ");
	const visibleFields = provider.fields.filter((f) => !f.group || f.group === oneOfGroup);

	return (
		<>
			{entry}
			{groups.length > 0 ? (
				<ChoiceGroup
					name="oneOfGroup"
					legend={<T id="dns-credentials.group" />}
					value={oneOfGroup}
					options={groups.map((group) => ({ value: group, label: groupLabel(group) }))}
					onChange={(group) => {
						setValue("oneOfGroup", group, { shouldDirty: true });
						// the other groups' fields are hidden now, so are their messages; the fields outside any
						// group keep theirs
						clearErrors(
							provider.fields
								.filter((f) => f.group && f.group !== group)
								.map((f) => `fieldValues.${f.key}`),
						);
					}}
				/>
			) : null}
			{visibleFields.map((definition) => (
				<ValueInput
					key={definition.key}
					definition={definition}
					saved={definition.type === "secret" && savedKeys.has(definition.key)}
				/>
			))}
		</>
	);
}
