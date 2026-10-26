import { IconAlertCircle, IconCircleCheck, IconExternalLink, IconInfoCircle } from "@tabler/icons-react";
import { Field, Form, Formik, useFormikContext } from "formik";
import { useEffect, useRef, useState } from "react";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	FormErrorNote,
	Loading,
	PasswordInput,
	SwitchField,
} from "src/components";
import { LeaveGuard, useGeoipSettings, useSaveGeoipSettings, useUpdateGeoipNow } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showObjectSuccess } from "src/notifications";
import { LockedBadge } from "./Authentication/LockedBadge";
import { StatusAlert } from "./StatusAlert";

const SIGNUP_URL = "https://www.maxmind.com/en/geolite2/signup";
const EDITIONS = [
	{ value: "GeoLite2-Country", key: "country" },
	{ value: "GeoLite2-ASN", key: "asn" },
	{ value: "GeoLite2-City", key: "city" },
];
const ACCOUNT_ID = /^[0-9]{0,10}$/u;
const EDITABLE = ["account_id", "license_key", "editions"];
// after a save with new credentials the download runs in the background: look for its outcome this often, this long
const POLL_MS = 3000;
const POLL_FOR_MS = 90 * 1000;

const camelToSnake = (key) => key.replaceAll(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`);
const sameEditions = (a, b) => a.length === b.length && a.every((edition) => b.includes(edition));

function Heading() {
	return (
		<h2 className="mb-3">
			<T id="settings.geoip" />
		</h2>
	);
}

function SaveButton({ allLocked }) {
	const { isSubmitting, dirty } = useFormikContext();
	return (
		<Button type="submit" color="teal" isLoading={isSubmitting} disabled={isSubmitting || allLocked || !dirty}>
			<T id="save" />
		</Button>
	);
}

const validate = (values) => {
	const errors = {};
	if (!ACCOUNT_ID.test(values.accountId.trim())) {
		errors.accountId = intl.formatMessage({ id: "settings.geoip.account-id.invalid" });
	}
	return errors;
};

function AccountFields({ data, isLocked }) {
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
			<Field name="accountId">
				{({ field, meta }) => (
					<div className="mb-3">
						<label className="form-label" htmlFor="geoip-account-id">
							<T id="settings.geoip.account-id" />
							{isLocked("accountId") ? <LockedBadge /> : null}
						</label>
						<input
							{...field}
							id="geoip-account-id"
							type="text"
							inputMode="numeric"
							autoComplete="off"
							className={`form-control${meta.error ? " is-invalid" : ""}`}
							disabled={isLocked("accountId")}
							aria-invalid={meta.error ? "true" : undefined}
						/>
						{meta.error ? <div className="invalid-feedback">{meta.error}</div> : null}
					</div>
				)}
			</Field>
			<Field name="licenseKey">
				{({ field }) => (
					<div className="mb-3">
						<PasswordInput
							{...field}
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
							value={keyLocked ? "" : (field.value ?? "")}
						/>
					</div>
				)}
			</Field>
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

function EditionFields({ isLocked }) {
	const { values, setFieldValue } = useFormikContext();
	const locked = isLocked("editions");
	const toggle = (edition, on) => {
		const next = on ? [...values.editions, edition] : values.editions.filter((e) => e !== edition);
		// keep the API order, so an unchanged selection is not seen as a change
		void setFieldValue(
			"editions",
			EDITIONS.map((e) => e.value).filter((e) => next.includes(e)),
		);
	};
	return (
		<div className="mb-4">
			<h3 className="card-title">
				<T id="settings.geoip.editions" />
				{locked ? <LockedBadge /> : null}
			</h3>
			<div className="divide-y">
				{EDITIONS.map(({ value, key }) => (
					<SwitchField
						key={value}
						className="py-2"
						id={`geoip-edition-${key}`}
						label={<T id={`settings.geoip.edition.${key}`} />}
						hint={<T id={`settings.geoip.edition.${key}.hint`} />}
						disabled={locked}
						checked={values.editions.includes(value)}
						onChange={(e) => toggle(value, e.target.checked)}
					/>
				))}
			</div>
			{values.editions.length === 0 ? (
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

export default function Geoip() {
	const { data, isPending, error, refetch } = useGeoipSettings();
	const { mutateAsync: save } = useSaveGeoipSettings();
	const [errorMsg, setErrorMsg] = useState(null);
	// set while a download started by a save runs in the background: { lastUpdate, lastError, until }
	const [background, setBackground] = useState(null);
	const errorRef = useRef(null);

	useEffect(() => {
		if (!errorMsg) return;
		errorRef.current?.scrollIntoView({ block: "nearest" });
		errorRef.current?.focus();
	}, [errorMsg]);

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

	const lockedKeys = data.locked ?? [];
	const locked = new Set(lockedKeys);
	const isLocked = (key) => locked.has(camelToSnake(key));
	const allLocked = EDITABLE.every((key) => locked.has(key));

	const onSubmit = async (values, { setSubmitting, setFieldValue }) => {
		setErrorMsg(null);
		const accountId = values.accountId.trim();
		const licenseKey = values.licenseKey.trim();
		// the backend downloads in the background when the account, the key or the editions change
		const startsDownload =
			(!isLocked("accountId") && accountId !== (data.accountId ?? "")) ||
			(!isLocked("licenseKey") && licenseKey !== "") ||
			(!isLocked("editions") && !sameEditions(values.editions, data.editions ?? []));
		try {
			await save({ ...values, accountId, licenseKey, locked: lockedKeys });
			setFieldValue("licenseKey", "");
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
		setSubmitting(false);
	};

	return (
		<Formik
			enableReinitialize
			initialValues={{
				accountId: data.accountId ?? "",
				licenseKey: "",
				editions: EDITIONS.map((e) => e.value).filter((e) => (data.editions ?? []).includes(e)),
			}}
			validate={validate}
			onSubmit={onSubmit}
		>
			<Form className="d-flex flex-column flex-fill">
				<div className="card-body flex-fill">
					<Heading />
					<div ref={errorRef} tabIndex={-1}>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
					</div>
					<StatusAlert variant="secondary" icon={IconInfoCircle} id="settings.geoip.intro" />
					{data.secretError ? (
						<StatusAlert variant="danger" icon={IconAlertCircle} id="settings.geoip.secret-error" />
					) : null}
					{locked.size > 0 ? (
						<StatusAlert variant="info" icon={IconInfoCircle} id="settings.authentication.status.locked" />
					) : null}
					{background ? (
						<StatusAlert variant="info" icon={IconInfoCircle} id="settings.geoip.background" />
					) : null}
					<AccountFields data={data} isLocked={isLocked} />
					<EditionFields isLocked={isLocked} />
					<UpdateStatus data={data} />
				</div>
				<div className="card-footer text-end">
					<LeaveGuard />
					<FormErrorNote className="me-3" />
					<SaveButton allLocked={allLocked} />
				</div>
			</Form>
		</Formik>
	);
}
