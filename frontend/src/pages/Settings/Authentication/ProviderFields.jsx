import { IconCircleCheck, IconCopy } from "@tabler/icons-react";
import { Field, useFormikContext } from "formik";
import { useState } from "react";
import { Button, ErrorAlert, PasswordInput, SwitchField } from "src/components";
import { useTestOidcSettings } from "src/hooks";
import { intl, T } from "src/locale";
import { LockedBadge } from "./LockedBadge";

function TextField({ name, label, hint, locked, type = "text", placeholder, ...rest }) {
	const id = `oidc-${name}`;
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
						value={field.value ?? ""}
						{...rest}
					/>
					{hint ? <div className="form-hint">{hint}</div> : null}
				</div>
			)}
		</Field>
	);
}

function ProviderFields({ data, isLocked }) {
	const { values, setFieldValue } = useFormikContext();
	const { mutate: testConnection, isPending: isTesting, reset } = useTestOidcSettings();
	const [result, setResult] = useState(null);

	const onTest = () => {
		setResult(null);
		reset();
		const payload = { issuerUrl: values.issuerUrl, clientId: values.clientId };
		if (values.clientSecret) payload.clientSecret = values.clientSecret;
		testConnection(payload, {
			onSuccess: (res) => setResult(res),
			onError: (err) => setResult({ ok: false, message: err?.message ?? String(err) }),
		});
	};

	const secretLocked = isLocked("clientSecret");
	const secretPlaceholder = intl.formatMessage({
		id: secretLocked
			? "settings.authentication.locked"
			: data.clientSecretSet
				? "settings.authentication.client-secret.saved"
				: "settings.authentication.client-secret.empty",
	});

	return (
		<div className="mb-4">
			<h4 className="mb-3">
				<T id="settings.authentication.provider" />
			</h4>
			<SwitchField
				className="mb-3"
				id="oidc-enabled"
				label={
					<>
						<T id="settings.authentication.enabled" />
						{isLocked("enabled") ? <LockedBadge /> : null}
					</>
				}
				disabled={isLocked("enabled")}
				checked={Boolean(values.enabled)}
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
						value={data.callbackUrl ?? ""}
					/>
					<button
						type="button"
						className="btn btn-icon"
						aria-label={intl.formatMessage({ id: "aria.copy" })}
						onClick={() => navigator.clipboard.writeText(data.callbackUrl ?? "")}
					>
						<IconCopy className="icon" aria-hidden="true" />
					</button>
				</div>
				<div className="form-hint">
					<T id="settings.authentication.callback-url.hint" />
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
			<div aria-live="polite">
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
				{result && !result.ok ? <ErrorAlert className="mt-3 mb-0">{result.message}</ErrorAlert> : null}
			</div>
		</div>
	);
}

export { ProviderFields };
