import cn from "clsx";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
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
import { useRecheckDependent } from "./HookForm";
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
 * The scheme, forward host and port of a proxy host or of a custom location: three fields in one row from the sm
 * breakpoint (the scheme and the port narrow, the host takes the rest), stacked on phones.
 *
 * @param {Object} props
 * @param {string} [props.base]       the row's path ("locations.2"), "" for the host
 * @param {string} [props.idSuffix]   the row's key, "" for the host
 * @param {string} [props.className]  of the row (the host window passes its bottom margin)
 */
export function ForwardFields({ base = "", idSuffix = "", className }) {
	const { getValues } = useFormContext();
	const field = (name) => optionField(base, name);
	const id = (name) => optionId(name, idSuffix);
	const scheme = useWatch({ name: field("forwardScheme") });
	const recheckHost = useRecheckDependent(field("forwardHost"));
	const applyOption = useApplyOption(base);
	const [resetNotice, setResetNotice] = useState(false);
	const hostRequired = scheme !== "empty";

	const onScheme = (event) => {
		const next = event.target.value;
		setResetNotice(getOptionsResetByScheme(base ? getValues(base) : getValues(), next).length > 0);
		applyOption("forwardScheme", next);
		// scheme is still the scheme before this change
		if (hostRecheckOnScheme(scheme, next)) recheckHost();
	};

	return (
		<div className={cn("grid items-start gap-3 sm:grid-cols-[8rem_1fr_7rem]", className)}>
			<SelectField
				name={field("forwardScheme")}
				id={id("forwardScheme")}
				label={<T id="host.forward-scheme" />}
				required
				hint={
					resetNotice ? (
						<span className="text-warning">
							<T id="host.forward-scheme.options-reset" />
						</span>
					) : undefined
				}
				className="mb-0"
				registerOptions={{ onChange: onScheme }}
			>
				{FORWARD_SCHEME_OPTIONS.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label ?? intl.formatMessage({ id: option.labelId })}
					</option>
				))}
			</SelectField>
			<TextField
				name={field("forwardHost")}
				id={id("forwardHost")}
				label={<T id="proxy-host.forward-host-path" />}
				required={hostRequired}
				hint={scheme === "path" ? <T id="host.forward-host.path-hint" /> : undefined}
				className="mb-0"
				type="text"
				placeholder="example.com"
			/>
			<TextField
				name={field("forwardPort")}
				id={id("forwardPort")}
				label={<T id="host.forward-port" />}
				className="mb-0"
				type="text"
				inputMode="numeric"
				placeholder={intl.formatMessage({ id: "form.example" }, { example: "8081" })}
			/>
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
			<SwitchList>
				{proxyOptionRows({ forwardScheme, npmproProxyRequestBuffering }).map((row) => (
					<SwitchField
						key={row.name}
						id={id(row.name)}
						label={<T id={row.labelId} />}
						hint={
							row.hintIds.length > 0
								? row.hintIds.map((hintId) => (
										<span key={hintId} className="block">
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
			<SelectField
				name={field("npmproXFrameOptions")}
				id={id("npmproXFrameOptions")}
				label="X-Frame-Options"
				className="mb-0"
			>
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
				className="mb-0"
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
