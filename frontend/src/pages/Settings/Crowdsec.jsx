import { CircleAlert, CircleCheck, CircleDashed, CircleX, ExternalLink, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Link } from "react-router";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	HookForm,
	PasswordField,
	SelectField,
	SettingLine,
	SettingLineNote,
	SwitchField,
	TextField,
	useAppForm,
} from "src/components";
import { useCrowdsecSettings, useSaveCrowdsecSettings, useTestCrowdsecSettings } from "src/hooks";
import { cn } from "src/lib/utils";
import { formatDateTime, intl, T } from "src/locale";
import {
	ADVANCED_FIELDS,
	appsecDenyWarning,
	bouncerOffWarning,
	CAPTCHA_PROVIDERS,
	CROWDSEC_FIELD_LABELS,
	CROWDSEC_RET_CODES,
	checkRows,
	crowdsecRequest,
	crowdsecValidate,
	crowdsecValues,
	failedChecks,
	forceBlocked,
} from "src/modules/CrowdsecForms";
import { lockedIn } from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { LockedBadge } from "./Authentication/LockedBadge";
import { SaveBar } from "./SaveBar";
import { SettingsCard } from "./SettingsCard";
import { SettingsForm } from "./SettingsForm";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsLead } from "./SettingsLead";
import { StatusAlert } from "./StatusAlert";

const label = (id) => intl.formatMessage({ id });

// isLocked and the lock badge of a field (camelCase name; lockedBy is camelized by base.js)
const useLocks = (data) => {
	const isLocked = lockedIn(data.locked);
	return { isLocked, badge: (name) => (isLocked(name) ? <LockedBadge env={data.lockedBy?.[name]} /> : null) };
};

const MODE_HINTS = { live: "settings.crowdsec.mode.live.hint", stream: "settings.crowdsec.mode.stream.hint" };
const BAN_HINTS = {
	page: "settings.crowdsec.ban-response.page.hint",
	redirect: "settings.crowdsec.ban-response.redirect.hint",
	status: "settings.crowdsec.ban-response.status.hint",
};

function CheckList({ checks }) {
	return (
		<ul className="space-y-1 text-sm">
			{checkRows(checks).map((row) => (
				<li key={row.name} className="flex items-start gap-2" data-crowdsec-check={row.name}>
					{row.ok ? (
						<CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
					) : (
						<CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
					)}
					<span className="min-w-0 break-words">
						<T id={row.labelId} />
						{row.detail ? <span className="text-muted-foreground"> ({row.detail})</span> : null}
					</span>
				</li>
			))}
		</ul>
	);
}

function StatusCard({ data, request }) {
	const { trigger } = useFormContext();
	const { mutate: runTest, isPending } = useTestCrowdsecSettings();
	const [result, setResult] = useState(null);
	const { status } = data;
	// the form is validated first (an empty required number would be sent as 0), its errors show in the fields
	const onTest = async () => {
		setResult(null);
		if (!(await trigger())) return;
		runTest(request(), { onSuccess: setResult, onError: (error) => setResult({ error }) });
	};
	return (
		<SettingsCard
			id="crowdsec-status"
			lines
			title={<T id="settings.crowdsec.status" />}
			info={<T id="settings.crowdsec.test.hint" />}
			actions={
				<Button outline color="secondary" isLoading={isPending} disabled={isPending} onClick={onTest}>
					<T id="settings.crowdsec.test" />
				</Button>
			}
		>
			{/* always mounted, so a screen reader announces the result that appears in it */}
			<SettingLineNote role="status" aria-live="polite" className="space-y-2 empty:hidden">
				{result?.error ? <ErrorAlert error={result.error} /> : null}
				{result?.checks ? <CheckList checks={result.checks} /> : null}
			</SettingLineNote>
			<SettingLine
				id="crowdsec-status-bouncer"
				layout="value"
				title={<T id="settings.crowdsec.status.bouncer" />}
				control={
					<span className="inline-flex items-center gap-1.5">
						{status.loaded ? (
							<CircleCheck className="size-4 text-success" aria-hidden="true" />
						) : (
							<CircleDashed className="size-4 text-muted-foreground" aria-hidden="true" />
						)}
						<T id={status.loaded ? "settings.crowdsec.status.loaded" : "settings.crowdsec.status.off"} />
					</span>
				}
			/>
			<SettingLine
				id="crowdsec-status-last-contact"
				layout="value"
				title={<T id="settings.crowdsec.status.last-contact" />}
				control={
					status.lastContact ? formatDateTime(status.lastContact) : <T id="settings.crowdsec.status.never" />
				}
			/>
			<SettingLine
				id="crowdsec-status-error"
				layout="value"
				title={<T id="settings.crowdsec.status.error" />}
				control={
					<span className={cn("break-words", status.error && "text-destructive")}>
						{status.error ?? <T id="settings.crowdsec.status.no-error" />}
					</span>
				}
			/>
		</SettingsCard>
	);
}

function ConnectionCard({ data, locks }) {
	const { register, setValue } = useFormContext();
	const [auth, clearApiKey, appsecUrl] = useWatch({ name: ["auth", "clearApiKey", "appsecUrl"] });
	// AppSec authenticates with the API key, also with a TLS client certificate
	const showKey = auth === "key" || String(appsecUrl ?? "").trim() !== "";
	const keyLocked = locks.isLocked("apiKey");
	let keyPlaceholder = "";
	if (keyLocked) keyPlaceholder = label("settings.authentication.locked");
	else if (data.apiKeySet && !data.secretError && !clearApiKey)
		keyPlaceholder = label("settings.crowdsec.api-key.saved");
	return (
		<SettingsCard
			id="crowdsec-connection"
			lines
			title={<T id="settings.crowdsec.connection" />}
			info={<T id="settings.crowdsec.connection.description" />}
		>
			<SwitchField
				line
				id="crowdsec-enabled"
				label={<T id="settings.crowdsec.enabled" />}
				hint={<T id="settings.crowdsec.enabled.hint" />}
				badges={locks.badge("enabled")}
				disabled={locks.isLocked("enabled")}
				{...register("enabled")}
			/>
			<TextField
				line="block"
				name="apiUrl"
				id="crowdsec-api-url"
				label={<T id="settings.crowdsec.api-url" />}
				hint={<T id="settings.crowdsec.api-url.hint" />}
				badges={locks.badge("apiUrl")}
				disabled={locks.isLocked("apiUrl")}
				type="url"
				autoComplete="off"
				spellCheck={false}
			/>
			<SelectField name="auth" id="crowdsec-auth" line="inline" label={<T id="settings.crowdsec.auth" />}>
				<option value="key">{label("settings.crowdsec.auth.key")}</option>
				<option value="tls">{label("settings.crowdsec.auth.tls")}</option>
			</SelectField>
			{showKey ? (
				// a locked or saved key stays empty: it is never shown
				<PasswordField
					line="block"
					name="apiKey"
					id="crowdsec-api-key"
					label={<T id="settings.crowdsec.api-key" />}
					hint={
						<T
							id={
								auth === "key"
									? "settings.crowdsec.api-key.hint"
									: "settings.crowdsec.api-key.appsec-hint"
							}
						/>
					}
					badges={locks.badge("apiKey")}
					autoComplete="new-password"
					disabled={keyLocked || clearApiKey}
					placeholder={keyPlaceholder}
					aside={
						data.apiKeySet && !keyLocked ? (
							<Button
								outline
								color="secondary"
								size="sm"
								onClick={() => setValue("clearApiKey", !clearApiKey, { shouldDirty: true })}
							>
								<T
									id={
										clearApiKey
											? "settings.crowdsec.api-key.keep"
											: "settings.crowdsec.api-key.remove"
									}
								/>
							</Button>
						) : null
					}
				/>
			) : null}
			{auth === "tls" ? (
				<>
					<TextField
						line="block"
						name="tlsClientCert"
						id="crowdsec-tls-cert"
						label={<T id="settings.crowdsec.tls-cert" />}
						hint={<T id="settings.crowdsec.tls-cert.hint" />}
						autoComplete="off"
						spellCheck={false}
					/>
					<TextField
						line="block"
						name="tlsClientKey"
						id="crowdsec-tls-key"
						label={<T id="settings.crowdsec.tls-key" />}
						hint={<T id="settings.crowdsec.tls-key.hint" />}
						autoComplete="off"
						spellCheck={false}
					/>
				</>
			) : null}
			<SwitchField
				line
				id="crowdsec-ssl-verify"
				label={<T id="settings.crowdsec.ssl-verify" />}
				hint={<T id="settings.crowdsec.ssl-verify.hint" />}
				{...register("sslVerify")}
			/>
		</SettingsCard>
	);
}

function BlockingCard() {
	const { register } = useFormContext();
	const [mode, banResponse] = useWatch({ name: ["mode", "banResponse"] });
	return (
		<SettingsCard
			id="crowdsec-blocking"
			lines
			title={<T id="settings.crowdsec.blocking" />}
			info={<T id="settings.crowdsec.blocking.description" />}
		>
			<SelectField
				name="mode"
				id="crowdsec-mode"
				line="inline"
				label={<T id="settings.crowdsec.mode" />}
				hint={MODE_HINTS[mode] ? <T id={MODE_HINTS[mode]} /> : null}
			>
				<option value="live">{label("settings.crowdsec.mode.live")}</option>
				<option value="stream">{label("settings.crowdsec.mode.stream")}</option>
			</SelectField>
			{mode === "live" ? (
				<TextField
					line="inline"
					name="cacheExpiration"
					id="crowdsec-cache-expiration"
					label={<T id="settings.crowdsec.cache-expiration" />}
					hint={<T id="settings.crowdsec.cache-expiration.hint" />}
					inputMode="numeric"
					autoComplete="off"
				/>
			) : (
				<TextField
					line="inline"
					name="updateFrequency"
					id="crowdsec-update-frequency"
					label={<T id="settings.crowdsec.update-frequency" />}
					hint={<T id="settings.crowdsec.update-frequency.hint" />}
					inputMode="numeric"
					autoComplete="off"
				/>
			)}
			<SelectField
				name="banResponse"
				id="crowdsec-ban-response"
				line="inline"
				label={<T id="settings.crowdsec.ban-response" />}
				hint={BAN_HINTS[banResponse] ? <T id={BAN_HINTS[banResponse]} /> : null}
			>
				<option value="page">{label("settings.crowdsec.ban-response.page")}</option>
				<option value="redirect">{label("settings.crowdsec.ban-response.redirect")}</option>
				<option value="status">{label("settings.crowdsec.ban-response.status")}</option>
			</SelectField>
			<SettingLineNote>
				<p className="text-sm text-muted-foreground">
					<T id="settings.crowdsec.pages-link" />{" "}
					<Link to="/settings/landing-pages" className="text-primary underline underline-offset-4">
						<T id="settings.landing-pages" />
					</Link>
				</p>
			</SettingLineNote>
			{banResponse === "redirect" ? (
				<TextField
					line="block"
					name="redirectLocation"
					id="crowdsec-redirect-location"
					label={<T id="settings.crowdsec.redirect-location" />}
					hint={<T id="settings.crowdsec.redirect-location.hint" />}
					autoComplete="off"
					spellCheck={false}
				/>
			) : (
				<SelectField
					line="inline"
					name="retCode"
					id="crowdsec-ret-code"
					label={<T id="settings.crowdsec.ret-code" />}
					hint={<T id="settings.crowdsec.ret-code.hint" />}
				>
					{banResponse === "page" ? (
						<option value="default">{label("settings.crowdsec.ret-code.default")}</option>
					) : null}
					{CROWDSEC_RET_CODES.map((code) => (
						<option key={code} value={code}>
							{code}
						</option>
					))}
				</SelectField>
			)}
			<SelectField
				line="inline"
				name="fallbackRemediation"
				id="crowdsec-fallback"
				label={<T id="settings.crowdsec.fallback" />}
				hint={<T id="settings.crowdsec.fallback.hint" />}
			>
				<option value="ban">{label("settings.crowdsec.fallback.ban")}</option>
				<option value="captcha">{label("settings.crowdsec.fallback.captcha")}</option>
			</SelectField>
			<SelectField
				line="inline"
				name="bouncingOnType"
				id="crowdsec-bouncing-on-type"
				label={<T id="settings.crowdsec.bouncing-on-type" />}
				hint={<T id="settings.crowdsec.bouncing-on-type.hint" />}
			>
				<option value="all">{label("settings.crowdsec.bouncing-on-type.all")}</option>
				<option value="ban">{label("settings.crowdsec.bouncing-on-type.ban")}</option>
				<option value="captcha">{label("settings.crowdsec.bouncing-on-type.captcha")}</option>
			</SelectField>
			<SwitchField
				line
				id="crowdsec-admin-ui-excluded"
				label={<T id="settings.crowdsec.admin-ui-excluded" />}
				hint={<T id="settings.crowdsec.admin-ui-excluded.hint" />}
				{...register("adminUiExcluded")}
			/>
		</SettingsCard>
	);
}

function CaptchaCard({ data }) {
	const provider = useWatch({ name: "captchaProvider" });
	const secretPlaceholder =
		data.captchaSecretSet && !data.secretError ? label("settings.crowdsec.secret-key.saved") : "";
	return (
		<SettingsCard
			id="crowdsec-captcha"
			lines
			title={<T id="settings.crowdsec.captcha" />}
			info={<T id="settings.crowdsec.captcha.description" />}
		>
			<SelectField
				line="inline"
				name="captchaProvider"
				id="crowdsec-captcha-provider"
				label={<T id="settings.crowdsec.captcha-provider" />}
				hint={<T id="settings.crowdsec.captcha-provider.hint" />}
			>
				{CAPTCHA_PROVIDERS.map((name) => (
					<option key={name} value={name}>
						{label(`settings.crowdsec.captcha-provider.${name}`)}
					</option>
				))}
			</SelectField>
			{provider === "none" ? null : (
				<>
					<TextField
						line="block"
						name="captchaSiteKey"
						id="crowdsec-site-key"
						label={<T id="settings.crowdsec.site-key" />}
						hint={<T id="settings.crowdsec.site-key.hint" />}
						autoComplete="off"
						spellCheck={false}
					/>
					<PasswordField
						line="block"
						name="captchaSecretKey"
						id="crowdsec-secret-key"
						label={<T id="settings.crowdsec.secret-key" />}
						hint={<T id="settings.crowdsec.secret-key.hint" />}
						autoComplete="new-password"
						placeholder={secretPlaceholder}
					/>
				</>
			)}
			<TextField
				line="inline"
				name="captchaExpiration"
				id="crowdsec-captcha-expiration"
				label={<T id="settings.crowdsec.captcha-expiration" />}
				hint={<T id="settings.crowdsec.captcha-expiration.hint" />}
				inputMode="numeric"
				autoComplete="off"
			/>
		</SettingsCard>
	);
}

function AppsecCard({ locks }) {
	const [appsecUrl, appsecFailureAction, adminUiExcluded] = useWatch({
		name: ["appsecUrl", "appsecFailureAction", "adminUiExcluded"],
	});
	return (
		<SettingsCard
			id="crowdsec-appsec"
			lines
			title={<T id="settings.crowdsec.appsec" />}
			info={<T id="settings.crowdsec.appsec.description" />}
		>
			<TextField
				line="block"
				name="appsecUrl"
				id="crowdsec-appsec-url"
				label={<T id="settings.crowdsec.appsec-url" />}
				hint={<T id="settings.crowdsec.appsec-url.hint" />}
				badges={locks.badge("appsecUrl")}
				disabled={locks.isLocked("appsecUrl")}
				type="url"
				autoComplete="off"
				spellCheck={false}
			/>
			<SelectField
				line="inline"
				name="appsecFailureAction"
				id="crowdsec-appsec-failure"
				label={<T id="settings.crowdsec.appsec-failure" />}
				hint={<T id="settings.crowdsec.appsec-failure.hint" />}
			>
				<option value="deny">{label("settings.crowdsec.appsec-failure.deny")}</option>
				<option value="passthrough">{label("settings.crowdsec.appsec-failure.passthrough")}</option>
			</SelectField>
			{appsecDenyWarning({ appsecUrl, appsecFailureAction, adminUiExcluded }) ? (
				<SettingLineNote>
					<StatusAlert variant="warning" icon={TriangleAlert} id="settings.crowdsec.appsec-deny-warning" />
				</SettingLineNote>
			) : null}
		</SettingsCard>
	);
}

function PreviewLink({ page }) {
	return (
		<a
			href={`/api/settings/crowdsec/preview/${page}`}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
		>
			<T id="settings.crowdsec.preview" />
			<ExternalLink className="size-3.5" aria-hidden="true" />
		</a>
	);
}

// The collapsed Advanced card; a refused save opens it when one of its fields holds the error. Closed, its fields stay
// mounted and keep their values.
function AdvancedFields() {
	const { register } = useFormContext();
	const text = (name, id, hintId, layout = "inline") => (
		<TextField
			name={name}
			id={id}
			line={layout}
			label={<T id={CROWDSEC_FIELD_LABELS[name]} />}
			hint={hintId ? <T id={hintId} /> : undefined}
			autoComplete="off"
			spellCheck={false}
		/>
	);
	const toggle = (name, id, labelId) => (
		<SwitchField line id={id} label={<T id={labelId} />} hint={<T id={`${labelId}.hint`} />} {...register(name)} />
	);
	return (
		<SettingsCard
			id="crowdsec-advanced"
			collapsible
			openOn={ADVANCED_FIELDS}
			lines
			title={<T id="settings.crowdsec.advanced" />}
			info={<T id="settings.crowdsec.advanced.description" />}
		>
			{text("requestTimeout", "crowdsec-request-timeout", "settings.crowdsec.request-timeout.hint")}
			{text(
				"scenariosContaining",
				"crowdsec-scenarios-containing",
				"settings.crowdsec.scenarios-containing.hint",
				"block",
			)}
			{text(
				"scenariosNotContaining",
				"crowdsec-scenarios-not-containing",
				"settings.crowdsec.scenarios-not-containing.hint",
				"block",
			)}
			{text("excludeLocation", "crowdsec-exclude-location", "settings.crowdsec.exclude-location.hint", "block")}
			{text("appsecConnectTimeout", "crowdsec-appsec-connect-timeout", "settings.crowdsec.appsec-timeout.hint")}
			{text("appsecSendTimeout", "crowdsec-appsec-send-timeout", "settings.crowdsec.appsec-timeout.hint")}
			{text("appsecProcessTimeout", "crowdsec-appsec-process-timeout", "settings.crowdsec.appsec-timeout.hint")}
			{toggle("enableInternal", "crowdsec-enable-internal", "settings.crowdsec.enable-internal")}
			{toggle("alwaysSendToAppsec", "crowdsec-always-send-to-appsec", "settings.crowdsec.always-send-to-appsec")}
			{toggle(
				"appsecDropUnreadableBody",
				"crowdsec-drop-unreadable-body",
				"settings.crowdsec.drop-unreadable-body",
			)}
			<SettingLineNote className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
				<span className="inline-flex items-center gap-2">
					<T id="settings.crowdsec.ban-response.page" />
					<PreviewLink page="ban" />
				</span>
				<span className="inline-flex items-center gap-2">
					<T id="settings.crowdsec.captcha" />
					<PreviewLink page="captcha" />
				</span>
			</SettingLineNote>
		</SettingsCard>
	);
}

// the bouncer is on in the settings but nginx does not load it: the file it needs and the way out
function BouncerOffAlert({ data }) {
	const warning = bouncerOffWarning(data);
	if (!warning) return null;
	return (
		<StatusAlert variant="warning" icon={TriangleAlert}>
			<div className="space-y-1">
				{warning.kind === "appsec-key" ? (
					<p>
						<T id="settings.crowdsec.bouncer-off.appsec-key" />
					</p>
				) : warning.kind === "tls" ? (
					<p>
						<T id="settings.crowdsec.bouncer-off.tls" data={{ files: warning.files.join(", ") }} />
					</p>
				) : (
					<p>
						<T id="settings.crowdsec.bouncer-off.other" />
					</p>
				)}
				{data.status.error ? (
					<p className="break-words text-muted-foreground">
						<T id="settings.crowdsec.bouncer-off.reason" data={{ error: data.status.error }} />
					</p>
				) : null}
			</div>
		</StatusAlert>
	);
}

// the checks of a save the connection test refused, and Save anyway
function RefusedSave({ checks, blocked, onSaveAnyway }) {
	return (
		<StatusAlert variant="danger" icon={CircleAlert}>
			<div className="space-y-2">
				<p className="font-medium">
					<T id={blocked ? "settings.crowdsec.test-failed" : "error.crowdsec-test-failed"} />
				</p>
				<CheckList checks={checks} />
				{blocked ? (
					<p>
						<T id="settings.crowdsec.save-blocked" />
					</p>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						<Button color="danger" outline size="sm" onClick={onSaveAnyway}>
							<T id="settings.crowdsec.save-anyway" />
						</Button>
						<span className="text-muted-foreground">
							<T id="settings.crowdsec.save-anyway.hint" />
						</span>
					</div>
				)}
			</div>
		</StatusAlert>
	);
}

/**
 * The form of the loaded settings: the saved settings are its values, also after a save or a refetch; the key fields
 * are emptied after a save, a saved key is never shown
 */
function CrowdsecForm({ data }) {
	const { mutateAsync: save } = useSaveCrowdsecSettings();
	const [errorMsg, setErrorMsg] = useState(null);
	const [refused, setRefused] = useState(null);
	const errorRef = useRef(null);
	const locks = useLocks(data);
	const saved = crowdsecValues(data);
	const methods = useAppForm({
		defaultValues: saved,
		values: saved,
		keepEdits: false,
		validate: crowdsecValidate(validations, locks.isLocked, data),
	});

	useEffect(() => {
		if (!(errorMsg || refused)) return;
		errorRef.current?.scrollIntoView({ block: "nearest" });
		errorRef.current?.focus();
	}, [errorMsg, refused]);

	const submit = async (values, force) => {
		setErrorMsg(null);
		setRefused(null);
		try {
			await save(crowdsecRequest(values, data, { force }));
			methods.setValue("apiKey", "", { shouldDirty: true });
			methods.setValue("captchaSecretKey", "", { shouldDirty: true });
			methods.setValue("clearApiKey", false, { shouldDirty: true });
			showObjectSuccess("setting", "saved");
		} catch (err) {
			const checks = failedChecks(err);
			if (checks) setRefused({ checks, blocked: forceBlocked(err) });
			else setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={(values) => submit(values, false)} className="space-y-4">
			<SettingsHeading titleId="settings.crowdsec" />
			<div ref={errorRef} tabIndex={-1} className="scroll-mt-32 space-y-2 empty:hidden">
				<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
				{refused ? (
					<RefusedSave
						checks={refused.checks}
						blocked={refused.blocked}
						onSaveAnyway={methods.handleSubmit((values) => submit(values, true))}
					/>
				) : null}
			</div>
			<BouncerOffAlert data={data} />
			<SettingsLead id="settings.crowdsec.intro" />
			{data.secretError ? (
				<StatusAlert variant="danger" icon={CircleAlert} id="settings.crowdsec.secret-error" />
			) : null}
			{(data.locked ?? []).length > 0 ? (
				<StatusAlert variant="info" icon={Lock} id="settings.authentication.status.locked" />
			) : null}
			<StatusCard data={data} request={() => crowdsecRequest(methods.getValues(), data)} />
			<ConnectionCard data={data} locks={locks} />
			<BlockingCard />
			<CaptchaCard data={data} />
			<AppsecCard locks={locks} />
			<AdvancedFields />
			<SaveBar labels={CROWDSEC_FIELD_LABELS} />
		</HookForm>
	);
}

export default function Crowdsec() {
	const { data, isPending, error } = useCrowdsecSettings();
	return (
		<SettingsForm titleId="settings.crowdsec" error={error} isPending={isPending}>
			{() => <CrowdsecForm data={data} />}
		</SettingsForm>
	);
}
