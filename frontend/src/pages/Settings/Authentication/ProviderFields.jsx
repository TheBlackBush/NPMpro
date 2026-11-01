import { IconCheck, IconCircleCheck, IconCopy } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useController, useWatch } from "react-hook-form";
import {
	Button,
	ErrorAlert,
	FormField,
	FormSection,
	PasswordField,
	SwitchField,
	SwitchList,
	TextField,
	useRecheckDependent,
} from "src/components";
import { useTestOidcSettings } from "src/hooks";
import { intl, T } from "src/locale";
import { AUTHENTICATION_RECHECKS } from "src/modules/AuthenticationForms";
import { LockedBadge } from "./LockedBadge";

const CONNECTION_KEYS = ["issuerUrl", "clientId", "clientSecret", "redirectDomain"];
const WATCHED = ["issuerUrl", "clientId", "clientSecret"];

/**
 * A text setting of the provider on the form layer's TextField: the lock badge in its label, disabled while locked
 */
function ProviderText({ name, label, hint, locked, type = "text", placeholder, onChange }) {
	return (
		<TextField
			name={name}
			id={`oidc-${name}`}
			label={
				<>
					{label}
					{locked ? <LockedBadge /> : null}
				</>
			}
			hint={hint}
			registerOptions={onChange ? { onChange } : undefined}
			type={type}
			autoComplete="off"
			placeholder={placeholder}
			disabled={locked}
		/>
	);
}

/**
 * The checks of the messages that follow a changed field (AUTHENTICATION_RECHECKS): the secret again after the issuer
 * or the client moved, "Disable password login" after the connection changed
 *
 * @returns {Function} (name) => () => void, for a field's onChange
 */
function useRecheckAfter() {
	const rechecks = {
		clientSecret: useRecheckDependent("clientSecret"),
		disablePassword: useRecheckDependent("disablePassword"),
	};
	return (name) => () => {
		for (const field of AUTHENTICATION_RECHECKS[name]) rechecks[field]();
	};
}

function ProviderFields({ data, isLocked }) {
	const { field: enabledField } = useController({ name: "enabled" });
	const watched = useWatch({ name: WATCHED });
	const values = Object.fromEntries(WATCHED.map((name, index) => [name, watched[index]]));
	const recheckAfter = useRecheckAfter();
	const { mutate: testConnection, isPending: isTesting, reset } = useTestOidcSettings();
	const [result, setResult] = useState(null);

	const [copied, setCopied] = useState(false);
	const copyTimer = useRef(null);
	useEffect(() => () => clearTimeout(copyTimer.current), []);

	// A stale result must not outlive the values it was produced for
	// biome-ignore lint/correctness/useExhaustiveDependencies: the values are the trigger, not read in the effect
	useEffect(() => {
		setResult(null);
	}, [values.issuerUrl, values.clientId, values.clientSecret]);

	const callbackUrl = data.callbackUrl ?? "";
	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(callbackUrl);
		} catch {
			return;
		}
		setCopied(true);
		clearTimeout(copyTimer.current);
		copyTimer.current = setTimeout(() => setCopied(false), 2000);
	};

	const onTest = () => {
		setResult(null);
		reset();
		const payload = { issuerUrl: values.issuerUrl, clientId: values.clientId };
		if (values.clientSecret) payload.clientSecret = values.clientSecret;
		testConnection(payload, {
			onSuccess: (res) => setResult(res),
			onError: (err) => setResult({ ok: false, error: err }),
		});
	};

	const secretLocked = isLocked("clientSecret");
	// With every connection value from env vars OIDC is active whatever the stored switch says
	const envOnly = CONNECTION_KEYS.every((key) => isLocked(key));
	const enabledLocked = envOnly || isLocked("enabled");
	// the saved secret is only sent to the issuer and client it was entered for (the API refuses the save otherwise)
	const connectionChanged =
		(!isLocked("issuerUrl") && (values.issuerUrl ?? "") !== (data.issuerUrl ?? "")) ||
		(!isLocked("clientId") && (values.clientId ?? "") !== (data.clientId ?? ""));
	const secretKey = () => {
		if (secretLocked) return "settings.authentication.locked";
		if (data.clientSecretSet && !data.secretError && connectionChanged)
			return "settings.authentication.client-secret.reenter";
		if (data.clientSecretSet && !data.secretError) return "settings.authentication.client-secret.saved";
		return "settings.authentication.client-secret.empty";
	};
	const secretPlaceholder = data.secretError && !secretLocked ? "" : intl.formatMessage({ id: secretKey() });

	return (
		<FormSection heading legend={<T id="settings.authentication.provider" />} className="mb-4">
			<SwitchList className="mb-3">
				<SwitchField
					id="oidc-enabled"
					label={
						<>
							<T id="settings.authentication.enabled" />
							{enabledLocked ? <LockedBadge /> : null}
						</>
					}
					name={enabledField.name}
					ref={enabledField.ref}
					onBlur={enabledField.onBlur}
					disabled={enabledLocked}
					checked={envOnly || Boolean(enabledField.value)}
					onChange={(e) => {
						enabledField.onChange(e.target.checked);
						recheckAfter("enabled")();
					}}
				/>
			</SwitchList>
			<ProviderText
				name="issuerUrl"
				type="url"
				label={<T id="settings.authentication.issuer-url" />}
				hint={<T id="settings.authentication.issuer-url.hint" />}
				locked={isLocked("issuerUrl")}
				placeholder="https://"
				onChange={recheckAfter("issuerUrl")}
			/>
			<ProviderText
				name="clientId"
				label={<T id="settings.authentication.client-id" />}
				locked={isLocked("clientId")}
				onChange={recheckAfter("clientId")}
			/>
			{/* a locked secret stays empty: the environment's secret is never shown */}
			<PasswordField
				name="clientSecret"
				id="oidc-clientSecret"
				label={
					<>
						<T id="settings.authentication.client-secret" />
						{secretLocked ? <LockedBadge /> : null}
					</>
				}
				autoComplete="new-password"
				disabled={secretLocked}
				placeholder={secretPlaceholder}
				registerOptions={{ onChange: recheckAfter("clientSecret") }}
			/>
			<ProviderText
				name="redirectDomain"
				label={<T id="settings.authentication.redirect-domain" />}
				hint={<T id="settings.authentication.redirect-domain.hint" />}
				locked={isLocked("redirectDomain")}
				onChange={recheckAfter("redirectDomain")}
			/>
			<FormField
				id="oidc-callbackUrl"
				label={<T id="settings.authentication.callback-url" />}
				hint={<T id="settings.authentication.callback-url.hint" />}
			>
				{(control) => (
					<div className="input-group">
						<input {...control} type="text" className="form-control" readOnly value={callbackUrl} />
						<button
							type="button"
							className="btn btn-icon"
							aria-label={intl.formatMessage({ id: "settings.authentication.callback-url.copy" })}
							disabled={!callbackUrl}
							onClick={onCopy}
						>
							{copied ? (
								<IconCheck className="icon" aria-hidden="true" />
							) : (
								<IconCopy className="icon" aria-hidden="true" />
							)}
						</button>
					</div>
				)}
			</FormField>
			<div className="visually-hidden" aria-live="polite">
				{copied ? <T id="settings.authentication.callback-url.copied" /> : null}
			</div>
			<ProviderText name="scopes" label={<T id="settings.authentication.scopes" />} locked={isLocked("scopes")} />
			<Button
				outline
				color="secondary"
				isLoading={isTesting}
				disabled={isTesting || !(values.issuerUrl && values.clientId)}
				onClick={onTest}
			>
				<T id="settings.authentication.test" />
			</Button>
			<div role="status">
				{result?.ok ? (
					<div className="alert alert-success mt-3 mb-0">
						<div className="alert-icon">
							<IconCircleCheck className="icon" aria-hidden="true" />
						</div>
						<div className="text-break">
							<T id="settings.authentication.test.ok" data={{ issuer: result.issuer }} />
						</div>
					</div>
				) : null}
				{result && !result.ok ? (
					<ErrorAlert className="mt-3 mb-0" error={result.error}>
						{result.message}
					</ErrorAlert>
				) : null}
			</div>
		</FormSection>
	);
}

export { ProviderFields };
