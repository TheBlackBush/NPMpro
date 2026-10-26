import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useField, useFormikContext } from "formik";
import { useState } from "react";
import { intl, T } from "src/locale";

// the backend's rules (lib/dns-credential-values.js, schema max length); url and number were browser checks
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/u;
const NUMBER = /^-?\d+(?:\.\d+)?$/u;
const HTTP_PROTOCOL = /^https?:$/u;
const MAX_VALUE = 4096;

const message = (id, data) => intl.formatMessage({ id }, data);

const valueError = (definition, saved) => (raw) => {
	const value = String(raw ?? "").trim();
	if (value === "") return definition.optional || saved ? undefined : message("error.required");
	if (value.length > MAX_VALUE) return message("error.max-character-length", { max: MAX_VALUE });
	if (CONTROL_CHARS.test(value)) return message("dns-credentials.value.control-chars");
	if (definition.type === "url" && !(URL.canParse(value) && HTTP_PROTOCOL.test(new URL(value).protocol))) {
		return message("dns-credentials.value.url");
	}
	if (definition.type === "number" && !NUMBER.test(value)) return message("dns-credentials.value.number");
};

// a field's error once it was left or a submit was tried
const shown = (meta, submitCount) => (meta.error && (meta.touched || submitCount > 0) ? meta.error : null);

function ValueInput({ definition, saved }) {
	const { submitCount } = useFormikContext();
	const name = `fieldValues.${definition.key}`;
	const [field, meta, helpers] = useField({ name, validate: valueError(definition, saved) });
	const error = shown(meta, submitCount);
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
					name={name}
					type={inputType}
					className={`form-control ${error ? "is-invalid" : ""}`}
					autoComplete="off"
					required={!definition.optional && !saved}
					aria-invalid={error ? "true" : undefined}
					aria-describedby={error ? `${id}-error` : undefined}
					placeholder={placeholder}
					value={field.value ?? ""}
					onBlur={() => helpers.setTouched(true)}
					onChange={(e) => helpers.setValue(e.target.value)}
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
	const { submitCount, setFieldValue } = useFormikContext();
	const [field, meta, helpers] = useField({
		name: "ini",
		validate: (value) =>
			String(value ?? "").trim() === "" && !credential?.iniSet ? message("error.required") : undefined,
	});
	const error = shown(meta, submitCount);
	return (
		<div className="mt-3">
			<label htmlFor="dnsCredentialIni" className="form-label">
				<T id="dns-credentials.ini" />
			</label>
			<textarea
				id="dnsCredentialIni"
				name="ini"
				className={`form-control font-monospace ${error ? "is-invalid" : ""}`}
				spellCheck={false}
				rows={6}
				required={!credential?.iniSet}
				aria-invalid={error ? "true" : undefined}
				aria-describedby={error ? "dnsCredentialIni-error" : undefined}
				placeholder={provider.credentials}
				value={field.value ?? ""}
				onBlur={() => helpers.setTouched(true)}
				onChange={(e) => helpers.setValue(e.target.value)}
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
						onClick={() => setFieldValue("useIni", false)}
					>
						<T id="dns-credentials.enter-as-fields" />
					</button>
				</div>
			) : null}
		</div>
	);
}

export function DnsCredentialValuesFields({ provider, credential }) {
	const { values, setFieldValue } = useFormikContext();
	if (!provider) {
		return null;
	}

	const showIni = !provider.fields || values.useIni;

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
	const visibleFields = provider.fields.filter((f) => !f.group || f.group === values.oneOfGroup);

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
								checked={values.oneOfGroup === group}
								onChange={() => setFieldValue("oneOfGroup", group)}
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
