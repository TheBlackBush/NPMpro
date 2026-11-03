import { CircleAlert, CircleCheck, ExternalLink, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useController, useFormState } from "react-hook-form";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	FormSection,
	HookForm,
	Loading,
	PasswordField,
	SwitchField,
	SwitchList,
	TextField,
	useAppForm,
} from "src/components";
import { useGeoipSettings, useSaveGeoipSettings, useUpdateGeoipNow } from "src/hooks";
import { cn } from "src/lib/utils";
import { formatDateTime, intl, T } from "src/locale";
import {
	GEOIP_EDITIONS,
	geoipRequest,
	geoipValidate,
	geoipValues,
	lockedIn,
	toggleEdition,
} from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { LockedBadge } from "./Authentication/LockedBadge";
import { SaveBar } from "./SaveBar";
import { SettingsCard } from "./SettingsCard";
import { SettingsHeading } from "./SettingsHeading";
import { StatusAlert } from "./StatusAlert";

const SIGNUP_URL = "https://www.maxmind.com/en/geolite2/signup";
const EDITABLE = ["account_id", "license_key", "editions"];
// after a save with new credentials the download runs in the background: look for its outcome this often, this long
const POLL_MS = 3000;
const POLL_FOR_MS = 90 * 1000;

function Heading() {
	return <SettingsHeading titleId="settings.geoip" />;
}

function SaveButton({ allLocked }) {
	const { isDirty } = useFormState();
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

function AccountFields({ data, isLocked }) {
	const keyLocked = isLocked("licenseKey");
	let keyPlaceholder = "";
	if (keyLocked) keyPlaceholder = intl.formatMessage({ id: "settings.authentication.locked" });
	else if (data.licenseKeySet && !data.secretError) {
		keyPlaceholder = intl.formatMessage({ id: "settings.authentication.client-secret.saved" });
	}
	return (
		<SettingsCard>
			<FormSection heading legend={<T id="settings.geoip.account" />} className="mb-0">
				<TextField
					name="accountId"
					id="geoip-account-id"
					label={
						<>
							<T id="settings.geoip.account-id" />
							{isLocked("accountId") ? <LockedBadge /> : null}
						</>
					}
					type="text"
					inputMode="numeric"
					autoComplete="off"
					disabled={isLocked("accountId")}
				/>
				{/* a locked key stays empty: the environment's key is never shown */}
				<PasswordField
					name="licenseKey"
					id="geoip-license-key"
					label={
						<>
							<T id="settings.geoip.license-key" />
							{keyLocked ? <LockedBadge /> : null}
						</>
					}
					autoComplete="new-password"
					disabled={keyLocked}
					placeholder={keyPlaceholder}
				/>
				<div className="text-sm text-muted-foreground">
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
				</div>
			</FormSection>
		</SettingsCard>
	);
}

// the editions: one field (the chosen list, in the API's order), its switches on a controller
function EditionFields({ isLocked }) {
	const { field } = useController({ name: "editions" });
	const locked = isLocked("editions");
	return (
		<SettingsCard>
			<FormSection
				heading
				legend={
					<>
						<T id="settings.geoip.editions" />
						{locked ? <LockedBadge /> : null}
					</>
				}
				className="mb-0"
			>
				<SwitchList>
					{GEOIP_EDITIONS.map(({ value, key }, index) => (
						<SwitchField
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
				</SwitchList>
				{field.value.length === 0 ? (
					<div className="text-sm text-muted-foreground">
						<T id="settings.geoip.editions.none" />
					</div>
				) : null}
			</FormSection>
		</SettingsCard>
	);
}

function UpdateStatus({ data }) {
	const { mutate: updateNow, isPending } = useUpdateGeoipNow();
	const [result, setResult] = useState(null);
	const canUpdate = Boolean(data.accountId && data.licenseKeySet && !data.secretError);

	const onUpdate = () => {
		setResult(null);
		updateNow(undefined, {
			onSuccess: (res) => setResult(res),
			onError: (err) => setResult({ ok: false, requestError: err }),
		});
	};

	return (
		<SettingsCard title={<T id="settings.geoip.status" />}>
			<dl className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] lg:grid-cols-[minmax(0,3fr)_minmax(0,9fr)]">
				<dt className="text-muted-foreground">
					<T id="settings.geoip.last-update" />
				</dt>
				<dd>{data.lastUpdate ? formatDateTime(data.lastUpdate) : <T id="settings.geoip.never" />}</dd>
				<dt className="text-muted-foreground">
					<T id="settings.geoip.last-error" />
				</dt>
				<dd className={cn("break-words", data.lastError && "text-destructive")}>
					{data.lastError ?? <T id="settings.geoip.no-error" />}
				</dd>
			</dl>
			<div className="space-y-2">
				<Button
					outline
					color="secondary"
					isLoading={isPending}
					disabled={isPending || !canUpdate}
					onClick={onUpdate}
				>
					<T id="settings.geoip.update-now" />
				</Button>
				<div className="text-sm text-muted-foreground">
					<T id={canUpdate ? "settings.geoip.update-now.hint" : "settings.geoip.update-now.needs-account"} />
				</div>
			</div>
			{result?.updated?.length > 0 ? (
				<StatusAlert
					variant="success"
					icon={CircleCheck}
					id="settings.geoip.update.ok"
					data={{ editions: result.updated.join(", ") }}
				/>
			) : null}
			{result?.ok && !(result.updated?.length > 0) ? (
				<StatusAlert variant="secondary" icon={Info} id="settings.geoip.update.unchanged" />
			) : null}
			{result && !result.ok ? (
				<ErrorAlert error={result.requestError}>
					{result.requestError ? null : (
						<T id="settings.geoip.update.failed" data={{ error: result.error }} />
					)}
				</ErrorAlert>
			) : null}
		</SettingsCard>
	);
}

/**
 * The form of the loaded settings: the saved settings are its values, also after a save or a refetch (new settings
 * replace every field); the key field is emptied after a save, a saved key is never shown
 */
function GeoipForm({ data, background, setBackground }) {
	const { mutateAsync: save } = useSaveGeoipSettings();
	const [errorMsg, setErrorMsg] = useState(null);
	const errorRef = useRef(null);
	const lockedKeys = data.locked ?? [];
	const isLocked = lockedIn(lockedKeys);
	const allLocked = EDITABLE.every((key) => lockedKeys.includes(key));
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
			await save(body);
			methods.setValue("licenseKey", "", { shouldDirty: true });
			showObjectSuccess("setting", "saved");
			if (startsDownload) {
				setBackground({
					lastUpdate: data.lastUpdate,
					lastError: data.lastError,
					until: Date.now() + POLL_FOR_MS,
				});
			}
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
			<StatusAlert variant="secondary" icon={Info} id="settings.geoip.intro" />
			{data.secretError ? (
				<StatusAlert variant="danger" icon={CircleAlert} id="settings.geoip.secret-error" />
			) : null}
			{lockedKeys.length > 0 ? (
				<StatusAlert variant="info" icon={Info} id="settings.authentication.status.locked" />
			) : null}
			{background ? <StatusAlert variant="info" icon={Info} id="settings.geoip.background" /> : null}
			<AccountFields data={data} isLocked={isLocked} />
			<EditionFields isLocked={isLocked} />
			<UpdateStatus data={data} />
			<SaveButton allLocked={allLocked} />
		</HookForm>
	);
}

export default function Geoip() {
	const { data, isPending, error, refetch } = useGeoipSettings();
	// set while a download started by a save runs in the background: { lastUpdate, lastError, until }
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
		if (!(background && data)) return;
		if (data.lastUpdate !== background.lastUpdate || data.lastError !== background.lastError) {
			setBackground(null);
		}
	}, [background, data]);

	if (error) {
		return (
			<div className="space-y-4">
				<Heading />
				<ErrorAlert error={error} />
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="space-y-4">
				<Heading />
				<Loading noLogo />
			</div>
		);
	}

	return <GeoipForm data={data} background={background} setBackground={setBackground} />;
}
