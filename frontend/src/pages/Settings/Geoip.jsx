import { CircleAlert, CircleCheck, ExternalLink, Info, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useController, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	Button,
	ChoiceField,
	ErrorAlert,
	GeoipCredit,
	HookForm,
	PasswordField,
	SettingLine,
	SettingLineNote,
	SwitchField,
	TextField,
	useAppForm,
} from "src/components";
import { useAccessListGeoip, useGeoipSettings, useSaveGeoipSettings, useUpdateGeoipNow } from "src/hooks";
import { cn } from "src/lib/utils";
import { formatDateTime, intl, T } from "src/locale";
import {
	DBIP_EDITIONS,
	GEOIP_EDITIONS,
	GEOIP_PROVIDERS,
	geoipOutcome,
	geoipOutcomeChanged,
	geoipRequest,
	geoipValidate,
	geoipValues,
	lockedIn,
	toggleDbipEdition,
	toggleEdition,
} from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { LockedBadge } from "./Authentication/LockedBadge";
import { SaveBar } from "./SaveBar";
import { SettingsCard } from "./SettingsCard";
import { SettingsForm } from "./SettingsForm";
import { SettingsHeading } from "./SettingsHeading";
import { SettingsLead } from "./SettingsLead";
import { StatusAlert } from "./StatusAlert";

const SIGNUP_URL = "https://www.maxmind.com/en/geolite2/signup";
// the fields each provider shows, in snake case like the API's locked list
const EDITABLE = {
	dbip: ["provider", "dbip_editions"],
	maxmind: ["provider", "account_id", "license_key", "editions"],
};
// after a save with new credentials the download runs in the background: look for its outcome this often, this long
const POLL_MS = 3000;
const POLL_FOR_MS = 90 * 1000;

function Heading() {
	return <SettingsHeading titleId="settings.geoip" />;
}

function SaveButton({ lockedKeys }) {
	const { isDirty } = useFormState();
	const provider = useWatch({ name: "provider" });
	const allLocked = EDITABLE[provider].every((key) => lockedKeys.includes(key));
	return (
		<SaveBar
			disabled={allLocked || !isDirty}
			reasonId={allLocked ? "settings.save.all-locked" : undefined}
			labels={FIELD_LABELS}
		/>
	);
}

// field name -> label, for the note next to Save (the inputs' ids differ from the field names)
const FIELD_LABELS = { accountId: "settings.geoip.account-id", licenseKey: "settings.geoip.license-key" };

function ProviderFields({ data, isLocked }) {
	const locked = isLocked("provider");
	return (
		<SettingsCard
			title={<T id="settings.geoip.provider" />}
			info={<T id="settings.geoip.provider.description" />}
			actions={locked ? <LockedBadge env={data.lockedBy?.provider} /> : null}
		>
			<ChoiceField
				name="provider"
				legend={<T id="settings.geoip.provider" />}
				hideLegend
				variant="boxes"
				vertical
				className="mb-0"
				disabled={locked}
				options={GEOIP_PROVIDERS.map(({ value, key }) => ({
					value,
					label: <T id={`settings.geoip.provider.${key}`} />,
					description: <T id={`settings.geoip.provider.${key}.hint`} />,
				}))}
			/>
		</SettingsCard>
	);
}

function AccountFields({ data, isLocked }) {
	const keyLocked = isLocked("licenseKey");
	let keyPlaceholder = "";
	if (keyLocked) keyPlaceholder = intl.formatMessage({ id: "settings.authentication.locked" });
	else if (data.licenseKeySet && !data.secretError) {
		keyPlaceholder = intl.formatMessage({ id: "settings.authentication.client-secret.saved" });
	}
	return (
		<SettingsCard
			lines
			title={<T id="settings.geoip.account" />}
			info={<T id="settings.geoip.account.description" />}
		>
			<TextField
				line="inline"
				name="accountId"
				id="geoip-account-id"
				label={<T id="settings.geoip.account-id" />}
				hint={<T id="settings.geoip.account-id.hint" />}
				badges={isLocked("accountId") ? <LockedBadge env={data.lockedBy?.accountId} /> : null}
				type="text"
				inputMode="numeric"
				autoComplete="off"
				disabled={isLocked("accountId")}
			/>
			{/* a locked key stays empty: the environment's key is never shown */}
			<PasswordField
				line="block"
				name="licenseKey"
				id="geoip-license-key"
				label={<T id="settings.geoip.license-key" />}
				badges={keyLocked ? <LockedBadge env={data.lockedBy?.licenseKey} /> : null}
				autoComplete="new-password"
				disabled={keyLocked}
				placeholder={keyPlaceholder}
			/>
			<SettingLineNote className="text-[0.8rem] text-muted-foreground">
				<T id="settings.geoip.account.hint" />{" "}
				<a
					href={SIGNUP_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline underline-offset-4"
				>
					<T id="settings.geoip.signup" />
					<ExternalLink className="ms-1 inline size-3.5 align-text-bottom" aria-hidden="true" />
				</a>
			</SettingLineNote>
		</SettingsCard>
	);
}

// the editions: one field (the chosen list, in the API's order), its switches on a controller
function EditionFields({ data, isLocked }) {
	const { field } = useController({ name: "editions" });
	const locked = isLocked("editions");
	return (
		<SettingsCard
			lines
			title={<T id="settings.geoip.editions" />}
			info={<T id="settings.geoip.editions.description" />}
			actions={locked ? <LockedBadge env={data.lockedBy?.editions} /> : null}
		>
			{GEOIP_EDITIONS.map(({ value, key }, index) => (
				<SwitchField
					line
					key={value}
					ref={index === 0 ? field.ref : undefined}
					id={`geoip-edition-${key}`}
					label={<T id={`settings.geoip.edition.${key}`} />}
					hint={<T id={`settings.geoip.edition.${key}.hint`} />}
					disabled={locked}
					checked={field.value.includes(value)}
					onBlur={field.onBlur}
					onChange={(e) => field.onChange(toggleEdition(field.value, value, e.target.checked))}
				/>
			))}
			{field.value.length === 0 ? (
				<SettingLineNote className="text-sm text-muted-foreground">
					<T id="settings.geoip.editions.none" />
				</SettingLineNote>
			) : null}
		</SettingsCard>
	);
}

// the DB-IP editions: one field (the chosen list, in the API's order), its switches on a controller
function DbipEditionFields({ data, isLocked }) {
	const { field } = useController({ name: "dbipEditions" });
	const locked = isLocked("dbipEditions");
	return (
		<SettingsCard
			lines
			title={<T id="settings.geoip.editions" />}
			info={<T id="settings.geoip.dbip.editions.description" />}
			actions={locked ? <LockedBadge env={data.lockedBy?.dbipEditions} /> : null}
		>
			{DBIP_EDITIONS.map(({ value, key }, index) => (
				<SwitchField
					line
					key={value}
					ref={index === 0 ? field.ref : undefined}
					id={`geoip-dbip-edition-${key}`}
					label={<T id={`settings.geoip.dbip.edition.${key}`} />}
					hint={<T id={`settings.geoip.dbip.edition.${key}.hint`} />}
					disabled={locked}
					checked={field.value.includes(value)}
					onBlur={field.onBlur}
					onChange={(e) => field.onChange(toggleDbipEdition(field.value, value, e.target.checked))}
				/>
			))}
			{field.value.length === 0 ? (
				<SettingLineNote className="text-sm text-muted-foreground">
					<T id="settings.geoip.editions.none" />
				</SettingLineNote>
			) : null}
			<SettingLineNote className="text-sm text-muted-foreground">
				<T id="settings.geoip.dbip.note" />
			</SettingLineNote>
		</SettingsCard>
	);
}

function UpdateStatus({ data }) {
	const { mutate: updateNow, isPending } = useUpdateGeoipNow();
	const [result, setResult] = useState(null);
	const dbip = data.provider === "dbip";
	const canUpdate = dbip
		? data.dbipEditions.length > 0
		: Boolean(data.accountId && data.licenseKeySet && !data.secretError);
	let infoId = "settings.geoip.update-now.needs-account";
	if (dbip) infoId = canUpdate ? "settings.geoip.update-now.hint.dbip" : "settings.geoip.editions.none";
	else if (canUpdate) infoId = "settings.geoip.update-now.hint";

	const onUpdate = () => {
		setResult(null);
		updateNow(undefined, {
			onSuccess: (res) => setResult(res),
			onError: (err) => setResult({ ok: false, requestError: err }),
		});
	};

	return (
		<SettingsCard
			lines
			title={<T id="settings.geoip.status" />}
			info={<T id={infoId} />}
			actions={
				<Button
					outline
					color="secondary"
					isLoading={isPending}
					disabled={isPending || !canUpdate}
					onClick={onUpdate}
				>
					<T id="settings.geoip.update-now" />
				</Button>
			}
		>
			{/* always mounted, so a screen reader announces the result that appears in it */}
			<SettingLineNote role="status" aria-live="polite" className="space-y-2 empty:hidden">
				{result?.updated?.length > 0 ? (
					<StatusAlert
						variant="success"
						icon={CircleCheck}
						id="settings.geoip.update.ok"
						data={{ editions: result.updated.join(", ") }}
						live={false}
					/>
				) : null}
				{result?.ok && !(result.updated?.length > 0) ? (
					<StatusAlert variant="secondary" icon={Info} id="settings.geoip.update.unchanged" live={false} />
				) : null}
				{result && !result.ok ? (
					<ErrorAlert error={result.requestError}>
						{result.requestError ? null : (
							<T id="settings.geoip.update.failed" data={{ error: result.error }} />
						)}
					</ErrorAlert>
				) : null}
			</SettingLineNote>
			<SettingLine
				id="geoip-last-update"
				layout="value"
				title={<T id="settings.geoip.last-update" />}
				control={data.lastUpdate ? formatDateTime(data.lastUpdate) : <T id="settings.geoip.never" />}
			/>
			<SettingLine
				id="geoip-last-check"
				layout="value"
				title={<T id="settings.geoip.last-check" />}
				control={data.lastCheck ? formatDateTime(data.lastCheck) : <T id="settings.geoip.never" />}
			/>
			<SettingLine
				id="geoip-last-error"
				layout="value"
				title={<T id="settings.geoip.last-error" />}
				control={
					<span className={cn("break-words", data.lastError && "text-destructive")}>
						{data.lastError ?? <T id="settings.geoip.no-error" />}
					</span>
				}
			/>
			<SettingLineNote>
				<GeoipCredit provider={data.provider} />
			</SettingLineNote>
		</SettingsCard>
	);
}

// the cards of the chosen provider (as chosen in the form, before a save)
function ProviderCards({ data, isLocked }) {
	const provider = useWatch({ name: "provider" });
	if (provider === "dbip") return <DbipEditionFields data={data} isLocked={isLocked} />;
	return (
		<>
			<AccountFields data={data} isLocked={isLocked} />
			<EditionFields data={data} isLocked={isLocked} />
		</>
	);
}

/**
 * The form of the loaded settings: the saved settings are its values, also after a save or a refetch (new settings
 * replace every field); the key field is emptied after a save, a saved key is never shown
 */
function GeoipForm({ data, background, setBackground }) {
	const { data: rules } = useAccessListGeoip();
	const { mutateAsync: save } = useSaveGeoipSettings();
	const [errorMsg, setErrorMsg] = useState(null);
	const errorRef = useRef(null);
	const lockedKeys = data.locked ?? [];
	const isLocked = lockedIn(lockedKeys);
	const saved = geoipValues(data);
	const methods = useAppForm({
		defaultValues: saved,
		values: saved,
		keepEdits: false,
		// a value set by env is the admin's (the backend takes it as it is): it never blocks saving the other fields
		validate: geoipValidate(validations, isLocked),
	});

	useEffect(() => {
		if (!errorMsg) return;
		errorRef.current?.scrollIntoView({ block: "nearest" });
		errorRef.current?.focus();
	}, [errorMsg]);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		// the backend downloads in the background when the account, the key or the editions change
		const { body, startsDownload } = geoipRequest(values, data);
		try {
			const after = await save(body);
			methods.setValue("licenseKey", "", { shouldDirty: true });
			showObjectSuccess("setting", "saved");
			// the snapshot is the save's answer: a switch already cleared the old error there
			if (startsDownload) setBackground({ outcome: geoipOutcome(after), until: Date.now() + POLL_FOR_MS });
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="space-y-4">
			<Heading />
			<div ref={errorRef} tabIndex={-1}>
				<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
			</div>
			<SettingsLead id="settings.geoip.intro" />
			{data.secretError ? (
				<StatusAlert variant="danger" icon={CircleAlert} id="settings.geoip.secret-error" />
			) : null}
			{lockedKeys.length > 0 ? (
				<StatusAlert variant="info" icon={Lock} id="settings.authentication.status.locked" />
			) : null}
			{background ? <StatusAlert variant="info" icon={Info} id="settings.geoip.background" /> : null}
			{rules?.customDirective ? (
				<StatusAlert variant="info" icon={Info} id="settings.geoip.custom-directive" />
			) : null}
			{rules?.listsWithRules > 0 && (!rules.available || rules.failsOpen) ? (
				<StatusAlert
					variant="danger"
					icon={CircleAlert}
					id={rules.available ? "settings.geoip.rules-fails-open" : "settings.geoip.rules-missing"}
					data={{ count: rules.listsWithRules }}
				/>
			) : null}
			<ProviderFields data={data} isLocked={isLocked} />
			<ProviderCards data={data} isLocked={isLocked} />
			<UpdateStatus data={data} />
			<SaveButton lockedKeys={lockedKeys} />
		</HookForm>
	);
}

export default function Geoip() {
	const { data, isPending, error, refetch } = useGeoipSettings();
	// set while a download started by a save runs in the background: { outcome, until }
	const [background, setBackground] = useState(null);

	useEffect(() => {
		if (!background) return;
		const timer = setInterval(() => {
			if (Date.now() > background.until) setBackground(null);
			else refetch();
		}, POLL_MS);
		return () => clearInterval(timer);
	}, [background, refetch]);

	// the background download is done once the stored outcome changes
	useEffect(() => {
		if (background && data && geoipOutcomeChanged(background.outcome, data)) setBackground(null);
	}, [background, data]);

	return (
		<SettingsForm titleId="settings.geoip" error={error} isPending={isPending}>
			{() => <GeoipForm data={data} background={background} setBackground={setBackground} />}
		</SettingsForm>
	);
}
