import { IconAlertCircle, IconCircleCheck, IconExternalLink, IconInfoCircle } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useController, useFormContext, useFormState } from "react-hook-form";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	HookForm,
	Loading,
	PasswordField,
	SwitchField,
	useAppForm,
} from "src/components";
import { useGeoipSettings, useSaveGeoipSettings, useUpdateGeoipNow } from "src/hooks";
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
import { StatusAlert } from "./StatusAlert";

const SIGNUP_URL = "https://www.maxmind.com/en/geolite2/signup";
const EDITABLE = ["account_id", "license_key", "editions"];
// after a save with new credentials the download runs in the background: look for its outcome this often, this long
const POLL_MS = 3000;
const POLL_FOR_MS = 90 * 1000;

function Heading() {
	return (
		<h2 className="mb-3">
			<T id="settings.geoip" />
		</h2>
	);
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
	const { register } = useFormContext();
	const { errors } = useFormState({ name: "accountId", exact: true });
	const accountError = errors.accountId?.message;
	const keyLocked = isLocked("licenseKey");
	let keyPlaceholder = "";
	if (keyLocked) keyPlaceholder = intl.formatMessage({ id: "settings.authentication.locked" });
	else if (data.licenseKeySet && !data.secretError) {
		keyPlaceholder = intl.formatMessage({ id: "settings.authentication.client-secret.saved" });
	}
	return (
		<div className="mb-4">
			<h3 className="card-title">
				<T id="settings.geoip.account" />
			</h3>
			<div className="mb-3">
				<label className="form-label" htmlFor="geoip-account-id">
					<T id="settings.geoip.account-id" />
					{isLocked("accountId") ? <LockedBadge /> : null}
				</label>
				<input
					{...register("accountId")}
					id="geoip-account-id"
					type="text"
					inputMode="numeric"
					autoComplete="off"
					className={`form-control${accountError ? " is-invalid" : ""}`}
					disabled={isLocked("accountId")}
					aria-invalid={accountError ? "true" : undefined}
				/>
				{accountError ? <div className="invalid-feedback">{accountError}</div> : null}
			</div>
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
			<div className="form-hint">
				<T id="settings.geoip.account.hint" />{" "}
				<a href={SIGNUP_URL} target="_blank" rel="noopener noreferrer" className="link-primary">
					<T id="settings.geoip.signup" />
					<IconExternalLink className="icon ms-1" aria-hidden="true" />
				</a>
			</div>
		</div>
	);
}

// the editions: one field (the chosen list, in the API's order), its switches on a controller
function EditionFields({ isLocked }) {
	const { field } = useController({ name: "editions" });
	const locked = isLocked("editions");
	return (
		<div className="mb-4">
			<h3 className="card-title">
				<T id="settings.geoip.editions" />
				{locked ? <LockedBadge /> : null}
			</h3>
			<div className="divide-y">
				{GEOIP_EDITIONS.map(({ value, key }, index) => (
					<SwitchField
						key={value}
						ref={index === 0 ? field.ref : undefined}
						className="py-2"
						id={`geoip-edition-${key}`}
						label={<T id={`settings.geoip.edition.${key}`} />}
						hint={<T id={`settings.geoip.edition.${key}.hint`} />}
						disabled={locked}
						checked={field.value.includes(value)}
						onBlur={field.onBlur}
						onChange={(e) => field.onChange(toggleEdition(field.value, value, e.target.checked))}
					/>
				))}
			</div>
			{field.value.length === 0 ? (
				<div className="form-hint">
					<T id="settings.geoip.editions.none" />
				</div>
			) : null}
		</div>
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
		<div>
			<h3 className="card-title">
				<T id="settings.geoip.status" />
			</h3>
			<dl className="row mb-3">
				<dt className="col-5 col-sm-4 col-lg-3">
					<T id="settings.geoip.last-update" />
				</dt>
				<dd className="col-7 col-sm-8 col-lg-9">
					{data.lastUpdate ? formatDateTime(data.lastUpdate) : <T id="settings.geoip.never" />}
				</dd>
				<dt className="col-5 col-sm-4 col-lg-3">
					<T id="settings.geoip.last-error" />
				</dt>
				<dd className={`col-7 col-sm-8 col-lg-9 text-break${data.lastError ? " text-danger" : ""}`}>
					{data.lastError ?? <T id="settings.geoip.no-error" />}
				</dd>
			</dl>
			<Button
				outline
				color="secondary"
				isLoading={isPending}
				disabled={isPending || !canUpdate}
				onClick={onUpdate}
			>
				<T id="settings.geoip.update-now" />
			</Button>
			<div className="form-hint">
				<T id={canUpdate ? "settings.geoip.update-now.hint" : "settings.geoip.update-now.needs-account"} />
			</div>
			{result?.updated?.length > 0 ? (
				<StatusAlert
					className="mt-3 mb-0"
					variant="success"
					icon={IconCircleCheck}
					id="settings.geoip.update.ok"
					data={{ editions: result.updated.join(", ") }}
				/>
			) : null}
			{result?.ok && !(result.updated?.length > 0) ? (
				<StatusAlert
					className="mt-3 mb-0"
					variant="secondary"
					icon={IconInfoCircle}
					id="settings.geoip.update.unchanged"
				/>
			) : null}
			{result && !result.ok ? (
				<ErrorAlert className="mt-3 mb-0" error={result.requestError}>
					{result.requestError ? null : (
						<T id="settings.geoip.update.failed" data={{ error: result.error }} />
					)}
				</ErrorAlert>
			) : null}
		</div>
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
		<HookForm methods={methods} onSubmit={onSubmit} className="d-flex flex-column flex-fill">
			<div className="card-body flex-fill">
				<Heading />
				<div ref={errorRef} tabIndex={-1}>
					<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
				</div>
				<StatusAlert variant="secondary" icon={IconInfoCircle} id="settings.geoip.intro" />
				{data.secretError ? (
					<StatusAlert variant="danger" icon={IconAlertCircle} id="settings.geoip.secret-error" />
				) : null}
				{lockedKeys.length > 0 ? (
					<StatusAlert variant="info" icon={IconInfoCircle} id="settings.authentication.status.locked" />
				) : null}
				{background ? (
					<StatusAlert variant="info" icon={IconInfoCircle} id="settings.geoip.background" />
				) : null}
				<AccountFields data={data} isLocked={isLocked} />
				<EditionFields isLocked={isLocked} />
				<UpdateStatus data={data} />
			</div>
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
			<div className="card-body">
				<Heading />
				<ErrorAlert error={error} />
			</div>
		);
	}

	if (isPending) {
		return (
			<div className="card-body">
				<Heading />
				<Loading noLogo />
			</div>
		);
	}

	return <GeoipForm data={data} background={background} setBackground={setBackground} />;
}
