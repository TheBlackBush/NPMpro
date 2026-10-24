import { IconCheck, IconCircleCheck, IconCopy } from "@tabler/icons-react";
import { Field, useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, PasswordInput, SwitchField } from "src/components";
import { useTestOidcSettings } from "src/hooks";
import { intl, T } from "src/locale";
import { LockedBadge } from "./LockedBadge";

const CONNECTION_KEYS = ["issuerUrl", "clientId", "clientSecret", "redirectDomain"];

function TextField({ name, label, hint, locked, type = "text", placeholder, ...rest }) {
	const id = `oidc-${name}`;
	const hintId = `${id}-hint`;
	return (
		<Field name={name}>
			{({ field }) => (
				<div className="mb-3">
					<label className="form-label" htmlFor={id}>
						{label}
						{locked ? <LockedBadge /> : null}
					</label>
					<input
						{...field}
						id={id}
						type={type}
						className="form-control"
						autoComplete="off"
						placeholder={placeholder}
						disabled={locked}
						aria-describedby={hint ? hintId : undefined}
						value={field.value ?? ""}
						{...rest}
					/>
					{hint ? (
						<div className="form-hint" id={hintId}>
							{hint}
						</div>
					) : null}
				</div>
			)}
		</Field>
	);
}

function ProviderFields({ data, isLocked }) {
	const { values, setFieldValue } = useFormikContext();
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
	const secretKey = () => {
		if (secretLocked) return "settings.authentication.locked";
		if (data.clientSecretSet && !data.secretError) return "settings.authentication.client-secret.saved";
		return "settings.authentication.client-secret.empty";
	};
	const secretPlaceholder = data.secretError && !secretLocked ? "" : intl.formatMessage({ id: secretKey() });

	return (
		<div className="mb-4">
			<h3 className="card-title">
				<T id="settings.authentication.provider" />
			</h3>
			<SwitchField
				className="mb-3"
				id="oidc-enabled"
				label={
					<>
						<T id="settings.authentication.enabled" />
						{enabledLocked ? <LockedBadge /> : null}
					</>
				}
				disabled={enabledLocked}
				checked={envOnly || Boolean(values.enabled)}
				onChange={(e) => setFieldValue("enabled", e.target.checked)}
			/>
			<TextField
				name="issuerUrl"
				type="url"
				label={<T id="settings.authentication.issuer-url" />}
				hint={<T id="settings.authentication.issuer-url.hint" />}
				locked={isLocked("issuerUrl")}
				placeholder="https://"
			/>
			<TextField
				name="clientId"
				label={<T id="settings.authentication.client-id" />}
				locked={isLocked("clientId")}
			/>
			<Field name="clientSecret">
				{({ field }) => (
					<div className="mb-3">
						<PasswordInput
							{...field}
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
							value={secretLocked ? "" : (field.value ?? "")}
						/>
					</div>
				)}
			</Field>
			<TextField
				name="redirectDomain"
				label={<T id="settings.authentication.redirect-domain" />}
				hint={<T id="settings.authentication.redirect-domain.hint" />}
				locked={isLocked("redirectDomain")}
			/>
			<div className="mb-3">
				<label className="form-label" htmlFor="oidc-callbackUrl">
					<T id="settings.authentication.callback-url" />
				</label>
				<div className="input-group">
					<input
						id="oidc-callbackUrl"
						type="text"
						className="form-control"
						readOnly
						aria-describedby="oidc-callbackUrl-hint"
						value={callbackUrl}
					/>
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
				<div className="form-hint" id="oidc-callbackUrl-hint">
					<T id="settings.authentication.callback-url.hint" />
				</div>
				<div className="visually-hidden" aria-live="polite">
					{copied ? <T id="settings.authentication.callback-url.copied" /> : null}
				</div>
			</div>
			<TextField name="scopes" label={<T id="settings.authentication.scopes" />} locked={isLocked("scopes")} />
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
		</div>
	);
}

export { ProviderFields };
