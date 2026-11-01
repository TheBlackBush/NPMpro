import cn from "clsx";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
import { controlAria, labelClass } from "src/modules/FormFields";
import { applyChanges } from "src/modules/HookForm";
import { hostRecheckOnScheme } from "src/modules/ProxyHostForms";
import {
	AUTH_REQUEST_OPTIONS,
	FORWARD_SCHEME_OPTIONS,
	getOptionsResetByScheme,
	optionField,
	optionId,
	proxyOptionChanges,
	proxyOptionRows,
	X_FRAME_OPTIONS,
} from "src/modules/ProxyOptions";
import { SelectField, TextField } from "./FormField";
import { FormSection } from "./FormSection";
import { useFieldError, useRecheckDependent } from "./HookForm";
import { SwitchField } from "./SwitchField";
import { SwitchList } from "./SwitchList";

// what a proxy option turns off or on, under the row's path (the option itself is set by register)
function useApplyOption(base) {
	const { setValue } = useFormContext();
	return (name, value) => {
		const { [name]: _changed, ...others } = proxyOptionChanges(name, value);
		applyChanges(setValue, others, base);
	};
}

/**
 * The scheme, forward host and port of a proxy host or of a custom location, in one row from the md breakpoint. The
 * three labels share the first line of the row, bottom aligned, and the controls the next line, so the controls line
 * up when a label wraps; on phones Bootstrap's order classes put each label above its control again.
 *
 * @param {Object} props
 * @param {string} [props.base]       the row's path ("locations.2"), "" for the host
 * @param {string} [props.idSuffix]   the row's key, "" for the host
 */
export function ForwardFields({ base = "", idSuffix = "" }) {
	const { register, getValues } = useFormContext();
	const field = (name) => optionField(base, name);
	const id = (name) => optionId(name, idSuffix);
	const scheme = useWatch({ name: field("forwardScheme") });
	const recheckHost = useRecheckDependent(field("forwardHost"));
	const hostError = useFieldError(field("forwardHost"));
	const portError = useFieldError(field("forwardPort"));
	const applyOption = useApplyOption(base);
	const [resetNotice, setResetNotice] = useState(false);
	const hostRequired = scheme !== "empty";
	const schemeAria = controlAria({ id: id("forwardScheme"), hasHint: resetNotice });
	const hostAria = controlAria({ id: id("forwardHost"), hasHint: scheme === "path", error: hostError });
	const portAria = controlAria({ id: id("forwardPort"), error: portError });

	const onScheme = (event) => {
		const next = event.target.value;
		setResetNotice(getOptionsResetByScheme(base ? getValues(base) : getValues(), next).length > 0);
		applyOption("forwardScheme", next);
		// scheme is still the scheme before this change
		if (hostRecheckOnScheme(scheme, next)) recheckHost();
	};

	return (
		<div className="row">
			<label
				className={cn(labelClass(), "col-12 col-md-3 order-first align-self-end")}
				htmlFor={id("forwardScheme")}
				id={schemeAria.labelId}
			>
				<T id="host.forward-scheme" />
			</label>
			<label
				className={cn(labelClass(hostRequired), "col-12 col-md-5 order-2 order-md-1 align-self-end")}
				htmlFor={id("forwardHost")}
				id={hostAria.labelId}
			>
				<T id="proxy-host.forward-host-path" />
			</label>
			<label
				className={cn(labelClass(), "col-12 col-md-4 order-4 order-md-2 align-self-end")}
				htmlFor={id("forwardPort")}
				id={portAria.labelId}
			>
				<T id="host.forward-port" />
			</label>
			<div className="col-12 col-md-3 order-1 order-md-3 mb-3">
				<select
					id={id("forwardScheme")}
					className="form-select"
					required
					aria-describedby={schemeAria["aria-describedby"]}
					{...register(field("forwardScheme"), { onChange: onScheme })}
				>
					{FORWARD_SCHEME_OPTIONS.map((option) => (
						<option key={option.value} value={option.value}>
							{option.label ?? intl.formatMessage({ id: option.labelId })}
						</option>
					))}
				</select>
				{resetNotice ? (
					<div className="form-hint text-warning" id={schemeAria.hintId}>
						<T id="host.forward-scheme.options-reset" />
					</div>
				) : null}
			</div>
			<div className="col-12 col-md-5 order-3 order-md-4 mb-3">
				<input
					id={id("forwardHost")}
					type="text"
					className={cn("form-control", hostError && "is-invalid")}
					placeholder="example.com"
					required={hostRequired}
					aria-invalid={hostAria["aria-invalid"]}
					aria-describedby={hostAria["aria-describedby"]}
					{...register(field("forwardHost"))}
				/>
				{hostError ? (
					<div className="invalid-feedback d-block" id={hostAria.errorId}>
						{hostError}
					</div>
				) : null}
				{scheme === "path" ? (
					<div className="form-hint" id={hostAria.hintId}>
						<T id="host.forward-host.path-hint" />
					</div>
				) : null}
			</div>
			<div className="col-12 col-md-4 order-5 order-md-5 mb-3">
				<div className={cn("input-group", portError && "has-validation")}>
					<input
						id={id("forwardPort")}
						type="text"
						inputMode="numeric"
						className={cn("form-control", portError && "is-invalid")}
						placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
						aria-invalid={portAria["aria-invalid"]}
						aria-describedby={portAria["aria-describedby"]}
						{...register(field("forwardPort"))}
					/>
					{portError ? (
						<div className="invalid-feedback d-block" id={portAria.errorId}>
							{portError}
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

/**
 * The proxy options of a proxy host or of a custom location, one block for both (UX-37): the option switches (a
 * change sets what it turns off or on, ProxyOptions.js), X-Frame-Options, the auth request and its upstream
 *
 * @param {Object} props
 * @param {string} [props.base]      the row's path ("locations.2"), "" for the host
 * @param {string} [props.idSuffix]  the row's key, "" for the host
 */
export function ProxyOptionsFields({ base = "", idSuffix = "" }) {
	const { register, clearErrors } = useFormContext();
	const field = (name) => optionField(base, name);
	const id = (name) => optionId(name, idSuffix);
	const applyOption = useApplyOption(base);
	const [forwardScheme, npmproProxyRequestBuffering, npmproAuthRequest] = useWatch({
		name: [field("forwardScheme"), field("npmproProxyRequestBuffering"), field("npmproAuthRequest")],
	});

	return (
		<FormSection heading legend={<T id="options" />}>
			<SwitchList className="mb-3">
				{proxyOptionRows({ forwardScheme, npmproProxyRequestBuffering }).map((row) => (
					<SwitchField
						key={row.name}
						id={id(row.name)}
						label={<T id={row.labelId} />}
						hint={
							row.hintIds.length > 0
								? row.hintIds.map((hintId) => (
										<span key={hintId} className="d-block">
											<T id={hintId} />
										</span>
									))
								: null
						}
						{...register(field(row.name), { onChange: (e) => applyOption(row.name, e.target.checked) })}
						disabled={row.disabled}
					/>
				))}
			</SwitchList>
			<SelectField name={field("npmproXFrameOptions")} id={id("npmproXFrameOptions")} label="X-Frame-Options">
				{X_FRAME_OPTIONS.map((value) => (
					<option key={value} value={value}>
						{value}
					</option>
				))}
			</SelectField>
			<SelectField
				name={field("npmproAuthRequest")}
				id={id("npmproAuthRequest")}
				label={<T id="host.auth-request" />}
				className={npmproAuthRequest === "none" ? "mb-0" : undefined}
				registerOptions={{
					onChange: (e) => {
						applyOption("npmproAuthRequest", e.target.value);
						// the upstream is hidden without an auth request
						if (e.target.value === "none") clearErrors(field("npmproAuthRequestUpstream"));
					},
				}}
			>
				{AUTH_REQUEST_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</SelectField>
			{npmproAuthRequest === "none" ? null : (
				<TextField
					name={field("npmproAuthRequestUpstream")}
					id={id("npmproAuthRequestUpstream")}
					label={<T id="host.auth-request-upstream" />}
					className="mb-0"
					type="text"
					maxLength={255}
					placeholder={intl.formatMessage({ id: "host.auth-request-upstream.placeholder" })}
				/>
			)}
		</FormSection>
	);
}
