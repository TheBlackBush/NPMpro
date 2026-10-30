import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";

// the rules of these fields are in modules/CertificateForms.js (dnsCredentialValidate), the window's resolver

function ValueInput({ definition, saved }) {
	const { register } = useFormContext();
	const name = `fieldValues.${definition.key}`;
	const error = useFormState({ name }).errors.fieldValues?.[definition.key]?.message ?? null;
	const [visible, setVisible] = useState(false);
	const id = `dnsCredentialField-${definition.key}`;
	const isSecret = definition.type === "secret";
	const placeholder = saved ? intl.formatMessage({ id: "dns-credentials.saved-keep" }) : definition.placeholder;
	let inputType = "text";
	if (isSecret) {
		inputType = visible ? "text" : "password";
	} else if (definition.type === "url" || definition.type === "number") {
		inputType = definition.type;
	}

	return (
		<div className="mt-3">
			<label htmlFor={id} className="form-label">
				{definition.label}
			</label>
			<div className={`input-group ${error ? "has-validation" : ""}`}>
				<input
					id={id}
					type={inputType}
					className={`form-control ${error ? "is-invalid" : ""}`}
					autoComplete="off"
					required={!definition.optional && !saved}
					aria-invalid={error ? "true" : undefined}
					aria-describedby={error ? `${id}-error` : undefined}
					placeholder={placeholder}
					{...register(name)}
				/>
				{isSecret ? (
					<button
						type="button"
						className="btn btn-icon"
						aria-label={intl.formatMessage({ id: "dns-credentials.show-secret" })}
						title={intl.formatMessage({ id: "dns-credentials.show-secret" })}
						onClick={() => setVisible(!visible)}
					>
						{visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
					</button>
				) : null}
				{error ? (
					<div className="invalid-feedback" id={`${id}-error`}>
						{error}
					</div>
				) : null}
			</div>
		</div>
	);
}

// the INI text, required unless one is saved
function IniInput({ provider, credential }) {
	const { register, setValue, clearErrors } = useFormContext();
	const error = useFormState({ name: "ini" }).errors.ini?.message ?? null;
	return (
		<div className="mt-3">
			<label htmlFor="dnsCredentialIni" className="form-label">
				<T id="dns-credentials.ini" />
			</label>
			<textarea
				id="dnsCredentialIni"
				className={`form-control font-monospace ${error ? "is-invalid" : ""}`}
				spellCheck={false}
				rows={6}
				required={!credential?.iniSet}
				aria-invalid={error ? "true" : undefined}
				aria-describedby={error ? "dnsCredentialIni-error" : undefined}
				placeholder={provider.credentials}
				{...register("ini")}
			/>
			{error ? (
				<div className="invalid-feedback" id="dnsCredentialIni-error">
					{error}
				</div>
			) : null}
			{credential?.iniSet ? (
				<small className="text-secondary">
					<T id="dns-credentials.saved-keep" />
				</small>
			) : null}
			{provider.fields && credential?.iniSet ? (
				<div>
					<button
						type="button"
						className="btn btn-link btn-sm p-0"
						onClick={() => {
							setValue("useIni", false, { shouldDirty: true });
							clearErrors("ini");
						}}
					>
						<T id="dns-credentials.enter-as-fields" />
					</button>
				</div>
			) : null}
		</div>
	);
}

export function DnsCredentialValuesFields({ provider, credential }) {
	const { setValue, clearErrors } = useFormContext();
	const [useIni, oneOfGroup] = useWatch({ name: ["useIni", "oneOfGroup"] });
	if (!provider) {
		return null;
	}

	const showIni = !provider.fields || useIni;

	if (showIni) {
		return <IniInput provider={provider} credential={credential} />;
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
			{groups.length > 0 ? (
				<div className="mt-3">
					{groups.map((group) => (
						<label key={group} className="form-check">
							<input
								type="radio"
								name="oneOfGroup"
								className="form-check-input"
								checked={oneOfGroup === group}
								onChange={() => {
									setValue("oneOfGroup", group, { shouldDirty: true });
									// the other groups' fields are hidden now, so are their messages; the fields
									// outside any group keep theirs
									clearErrors(
										provider.fields
											.filter((f) => f.group && f.group !== group)
											.map((f) => `fieldValues.${f.key}`),
									);
								}}
							/>
							<span className="form-check-label">{groupLabel(group)}</span>
						</label>
					))}
				</div>
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
