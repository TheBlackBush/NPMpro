import { CircleAlert, CircleCheck, CircleDashed, CircleX, ExternalLink, Info, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useController, useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	Button,
	ChoiceGroup,
	ErrorAlert,
	HookForm,
	PasswordField,
	SelectField,
	SwitchField,
	SwitchList,
	TextField,
	useAppForm,
} from "src/components";
import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "src/components/ui/accordion";
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
import { StatusAlert } from "./StatusAlert";

const label = (id) => intl.formatMessage({ id });

// isLocked and the lock badge of a field (camelCase name; lockedBy is camelized by base.js)
const useLocks = (data) => {
	const isLocked = lockedIn(data.locked);
	return { isLocked, badge: (name) => (isLocked(name) ? <LockedBadge env={data.lockedBy?.[name]} /> : null) };
};

// a ChoiceGroup bound to one field of the form
function Choice({ name, legendId, options, variant = "boxes" }) {
	const { field } = useController({ name });
	return (
		<ChoiceGroup
			name={`crowdsec-${name}`}
			legend={<T id={legendId} />}
			variant={variant}
			fill
			value={field.value}
			inputRef={field.ref}
			onBlur={field.onBlur}
			onChange={field.onChange}
			options={options}
		/>
	);
}

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
			title={<T id="settings.crowdsec.status" />}
			actions={
				<Button outline color="secondary" isLoading={isPending} disabled={isPending} onClick={onTest}>
					<T id="settings.crowdsec.test" />
				</Button>
			}
		>
			<dl className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)]">
				<dt className="text-muted-foreground">
					<T id="settings.crowdsec.status.bouncer" />
				</dt>
				<dd className="flex items-center gap-1.5">
					{status.loaded ? (
						<CircleCheck className="size-4 text-success" aria-hidden="true" />
					) : (
						<CircleDashed className="size-4 text-muted-foreground" aria-hidden="true" />
					)}
					<T id={status.loaded ? "settings.crowdsec.status.loaded" : "settings.crowdsec.status.off"} />
				</dd>
				<dt className="text-muted-foreground">
					<T id="settings.crowdsec.status.last-contact" />
				</dt>
				<dd>
					{status.lastContact ? (
						formatDateTime(status.lastContact)
					) : (
						<T id="settings.crowdsec.status.never" />
					)}
				</dd>
				<dt className="text-muted-foreground">
					<T id="settings.crowdsec.status.error" />
				</dt>
				<dd className={cn("break-words", status.error && "text-destructive")}>
					{status.error ?? <T id="settings.crowdsec.status.no-error" />}
				</dd>
			</dl>
			<div className="text-sm text-muted-foreground">
				<T id="settings.crowdsec.test.hint" />
			</div>
			{/* always mounted, so a screen reader announces the result that appears in it */}
			<div role="status" aria-live="polite" className="space-y-2 empty:hidden">
				{result?.error ? <ErrorAlert error={result.error} /> : null}
				{result?.checks ? <CheckList checks={result.checks} /> : null}
			</div>
		</SettingsCard>
	);
}

function ConnectionCard({ data, locks }) {
	const { register, setValue } = useFormContext();
	const [auth, clearApiKey] = useWatch({ name: ["auth", "clearApiKey"] });
	const keyLocked = locks.isLocked("apiKey");
	let keyPlaceholder = "";
	if (keyLocked) keyPlaceholder = label("settings.authentication.locked");
	else if (data.apiKeySet && !data.secretError && !clearApiKey)
		keyPlaceholder = label("settings.crowdsec.api-key.saved");
	return (
		<SettingsCard title={<T id="settings.crowdsec.connection" />}>
			<SwitchList>
				<SwitchField
					id="crowdsec-enabled"
					label={<T id="settings.crowdsec.enabled" />}
					hint={<T id="settings.crowdsec.enabled.hint" />}
					badges={locks.badge("enabled")}
					disabled={locks.isLocked("enabled")}
					{...register("enabled")}
				/>
			</SwitchList>
			<TextField
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
			<Choice
				name="auth"
				legendId="settings.crowdsec.auth"
				variant="pills"
				options={[
					{ value: "key", label: <T id="settings.crowdsec.auth.key" /> },
					{ value: "tls", label: <T id="settings.crowdsec.auth.tls" /> },
				]}
			/>
			{auth === "key" ? (
				<div className="space-y-2">
					{/* a locked or saved key stays empty: it is never shown */}
					<PasswordField
						name="apiKey"
						id="crowdsec-api-key"
						label={<T id="settings.crowdsec.api-key" />}
						hint={<T id="settings.crowdsec.api-key.hint" />}
						badges={locks.badge("apiKey")}
						autoComplete="new-password"
						disabled={keyLocked || clearApiKey}
						placeholder={keyPlaceholder}
					/>
					{data.apiKeySet && !keyLocked ? (
						<Button
							outline
							color="secondary"
							size="sm"
							onClick={() => setValue("clearApiKey", !clearApiKey, { shouldDirty: true })}
						>
							<T
								id={clearApiKey ? "settings.crowdsec.api-key.keep" : "settings.crowdsec.api-key.remove"}
							/>
						</Button>
					) : null}
				</div>
			) : (
				<>
					<TextField
						name="tlsClientCert"
						id="crowdsec-tls-cert"
						label={<T id="settings.crowdsec.tls-cert" />}
						hint={<T id="settings.crowdsec.tls-cert.hint" />}
						autoComplete="off"
						spellCheck={false}
					/>
					<TextField
						name="tlsClientKey"
						id="crowdsec-tls-key"
						label={<T id="settings.crowdsec.tls-key" />}
						hint={<T id="settings.crowdsec.tls-key.hint" />}
						autoComplete="off"
						spellCheck={false}
					/>
				</>
			)}
			<SwitchList>
				<SwitchField
					id="crowdsec-ssl-verify"
					label={<T id="settings.crowdsec.ssl-verify" />}
					hint={<T id="settings.crowdsec.ssl-verify.hint" />}
					{...register("sslVerify")}
				/>
			</SwitchList>
		</SettingsCard>
	);
}

function BlockingCard() {
	const { register } = useFormContext();
	const [mode, banResponse] = useWatch({ name: ["mode", "banResponse"] });
	return (
		<SettingsCard title={<T id="settings.crowdsec.blocking" />}>
			<Choice
				name="mode"
				legendId="settings.crowdsec.mode"
				options={[
					{
						value: "live",
						label: <T id="settings.crowdsec.mode.live" />,
						description: <T id="settings.crowdsec.mode.live.hint" />,
					},
					{
						value: "stream",
						label: <T id="settings.crowdsec.mode.stream" />,
						description: <T id="settings.crowdsec.mode.stream.hint" />,
					},
				]}
			/>
			{mode === "live" ? (
				<TextField
					name="cacheExpiration"
					id="crowdsec-cache-expiration"
					label={<T id="settings.crowdsec.cache-expiration" />}
					hint={<T id="settings.crowdsec.cache-expiration.hint" />}
					inputMode="numeric"
					autoComplete="off"
				/>
			) : (
				<TextField
					name="updateFrequency"
					id="crowdsec-update-frequency"
					label={<T id="settings.crowdsec.update-frequency" />}
					hint={<T id="settings.crowdsec.update-frequency.hint" />}
					inputMode="numeric"
					autoComplete="off"
				/>
			)}
			<Choice
				name="banResponse"
				legendId="settings.crowdsec.ban-response"
				options={[
					{
						value: "page",
						label: <T id="settings.crowdsec.ban-response.page" />,
						description: <T id="settings.crowdsec.ban-response.page.hint" />,
					},
					{
						value: "redirect",
						label: <T id="settings.crowdsec.ban-response.redirect" />,
						description: <T id="settings.crowdsec.ban-response.redirect.hint" />,
					},
					{
						value: "status",
						label: <T id="settings.crowdsec.ban-response.status" />,
						description: <T id="settings.crowdsec.ban-response.status.hint" />,
					},
				]}
			/>
			{banResponse === "redirect" ? (
				<TextField
					name="redirectLocation"
					id="crowdsec-redirect-location"
					label={<T id="settings.crowdsec.redirect-location" />}
					hint={<T id="settings.crowdsec.redirect-location.hint" />}
					autoComplete="off"
					spellCheck={false}
				/>
			) : (
				<SelectField
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
				name="fallbackRemediation"
				id="crowdsec-fallback"
				label={<T id="settings.crowdsec.fallback" />}
				hint={<T id="settings.crowdsec.fallback.hint" />}
			>
				<option value="ban">{label("settings.crowdsec.fallback.ban")}</option>
				<option value="captcha">{label("settings.crowdsec.fallback.captcha")}</option>
			</SelectField>
			<SelectField
				name="bouncingOnType"
				id="crowdsec-bouncing-on-type"
				label={<T id="settings.crowdsec.bouncing-on-type" />}
				hint={<T id="settings.crowdsec.bouncing-on-type.hint" />}
			>
				<option value="all">{label("settings.crowdsec.bouncing-on-type.all")}</option>
				<option value="ban">{label("settings.crowdsec.bouncing-on-type.ban")}</option>
				<option value="captcha">{label("settings.crowdsec.bouncing-on-type.captcha")}</option>
			</SelectField>
			<SwitchList>
				<SwitchField
					id="crowdsec-admin-ui-excluded"
					label={<T id="settings.crowdsec.admin-ui-excluded" />}
					hint={<T id="settings.crowdsec.admin-ui-excluded.hint" />}
					{...register("adminUiExcluded")}
				/>
			</SwitchList>
		</SettingsCard>
	);
}

function CaptchaCard({ data }) {
	const provider = useWatch({ name: "captchaProvider" });
	const secretPlaceholder =
		data.captchaSecretSet && !data.secretError ? label("settings.crowdsec.secret-key.saved") : "";
	return (
		<SettingsCard title={<T id="settings.crowdsec.captcha" />}>
			<SelectField
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
						name="captchaSiteKey"
						id="crowdsec-site-key"
						label={<T id="settings.crowdsec.site-key" />}
						hint={<T id="settings.crowdsec.site-key.hint" />}
						autoComplete="off"
						spellCheck={false}
					/>
					<PasswordField
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
		<SettingsCard title={<T id="settings.crowdsec.appsec" />}>
			<TextField
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
				name="appsecFailureAction"
				id="crowdsec-appsec-failure"
				label={<T id="settings.crowdsec.appsec-failure" />}
				hint={<T id="settings.crowdsec.appsec-failure.hint" />}
			>
				<option value="deny">{label("settings.crowdsec.appsec-failure.deny")}</option>
				<option value="passthrough">{label("settings.crowdsec.appsec-failure.passthrough")}</option>
			</SelectField>
			{appsecDenyWarning({ appsecUrl, appsecFailureAction, adminUiExcluded }) ? (
				<StatusAlert variant="warning" icon={TriangleAlert} id="settings.crowdsec.appsec-deny-warning" />
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

// The collapsed Advanced part; a refused save opens it when one of its fields holds the error (while rendering, so it
// is open when the first error gets the focus). Closed, its fields stay mounted and keep their values.
function AdvancedFields() {
	const { register } = useFormContext();
	const { errors, submitCount } = useFormState();
	const [open, setOpen] = useState([]);
	const [seenSubmits, setSeenSubmits] = useState(submitCount);
	if (submitCount !== seenSubmits) {
		setSeenSubmits(submitCount);
		if (ADVANCED_FIELDS.some((name) => errors[name]) && !open.includes("advanced")) setOpen(["advanced"]);
	}
	const text = (name, id, hintId) => (
		<TextField
			name={name}
			id={id}
			label={<T id={CROWDSEC_FIELD_LABELS[name]} />}
			hint={hintId ? <T id={hintId} /> : undefined}
			autoComplete="off"
			spellCheck={false}
		/>
	);
	const toggle = (name, id, labelId) => (
		<SwitchField id={id} label={<T id={labelId} />} hint={<T id={`${labelId}.hint`} />} {...register(name)} />
	);
	return (
		<Accordion type="multiple" value={open} onValueChange={setOpen} className="rounded-lg border px-4">
			<AccordionItem value="advanced">
				<AccordionTrigger
					className="items-center hover:no-underline"
					id="crowdsec-advanced-trigger"
					aria-controls="crowdsec-advanced-panel"
				>
					<span className="text-base font-medium">
						<T id="settings.crowdsec.advanced" />
					</span>
				</AccordionTrigger>
				<AccordionPanel
					id="crowdsec-advanced-panel"
					aria-labelledby="crowdsec-advanced-trigger"
					open={open.includes("advanced")}
					className="space-y-4"
				>
					{text("requestTimeout", "crowdsec-request-timeout", "settings.crowdsec.request-timeout.hint")}
					{text(
						"scenariosContaining",
						"crowdsec-scenarios-containing",
						"settings.crowdsec.scenarios-containing.hint",
					)}
					{text(
						"scenariosNotContaining",
						"crowdsec-scenarios-not-containing",
						"settings.crowdsec.scenarios-not-containing.hint",
					)}
					{text("excludeLocation", "crowdsec-exclude-location", "settings.crowdsec.exclude-location.hint")}
					{text(
						"appsecConnectTimeout",
						"crowdsec-appsec-connect-timeout",
						"settings.crowdsec.appsec-timeout.hint",
					)}
					{text("appsecSendTimeout", "crowdsec-appsec-send-timeout", "settings.crowdsec.appsec-timeout.hint")}
					{text(
						"appsecProcessTimeout",
						"crowdsec-appsec-process-timeout",
						"settings.crowdsec.appsec-timeout.hint",
					)}
					<SwitchList>
						{toggle("enableInternal", "crowdsec-enable-internal", "settings.crowdsec.enable-internal")}
						{toggle(
							"alwaysSendToAppsec",
							"crowdsec-always-send-to-appsec",
							"settings.crowdsec.always-send-to-appsec",
						)}
						{toggle(
							"appsecDropUnreadableBody",
							"crowdsec-drop-unreadable-body",
							"settings.crowdsec.drop-unreadable-body",
						)}
					</SwitchList>
					<div className="space-y-1">
						{text("banTemplatePath", "crowdsec-ban-template", "settings.crowdsec.template.hint")}
						<PreviewLink page="ban" />
					</div>
					<div className="space-y-1">
						{text("captchaTemplatePath", "crowdsec-captcha-template", "settings.crowdsec.template.hint")}
						<PreviewLink page="captcha" />
					</div>
				</AccordionPanel>
			</AccordionItem>
		</Accordion>
	);
}

// the bouncer is on in the settings but nginx does not load it: the file it needs and the way out
function BouncerOffAlert({ data }) {
	const warning = bouncerOffWarning(data);
	if (!warning) return null;
	return (
		<StatusAlert variant="warning" icon={TriangleAlert}>
			<div className="space-y-1">
				{warning.kind === "tls" ? (
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
					<T id="error.crowdsec-test-failed" />
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
			<StatusAlert variant="secondary" icon={Info} id="settings.crowdsec.intro" />
			{data.secretError ? (
				<StatusAlert variant="danger" icon={CircleAlert} id="settings.crowdsec.secret-error" />
			) : null}
			{(data.locked ?? []).length > 0 ? (
				<StatusAlert variant="info" icon={Info} id="settings.authentication.status.locked" />
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
