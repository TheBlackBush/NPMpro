import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useFormikContext } from "formik";
import { useState } from "react";
import { intl, T } from "src/locale";

function ValueInput({ definition, saved }) {
	const { values, setFieldValue } = useFormikContext();
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
			<div className="input-group">
				<input
					id={id}
					type={inputType}
					className="form-control"
					autoComplete="off"
					required={!definition.optional && !saved}
					placeholder={placeholder}
					value={values.fieldValues?.[definition.key] ?? ""}
					onChange={(e) => setFieldValue(`fieldValues.${definition.key}`, e.target.value)}
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
			</div>
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
		return (
			<div className="mt-3">
				<label htmlFor="dnsCredentialIni" className="form-label">
					<T id="dns-credentials.ini" />
				</label>
				<textarea
					id="dnsCredentialIni"
					className="form-control font-monospace"
					spellCheck={false}
					rows={6}
					placeholder={provider.credentials}
					value={values.ini ?? ""}
					onChange={(e) => setFieldValue("ini", e.target.value)}
				/>
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
