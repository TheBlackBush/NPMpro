import { IconInfoCircle } from "@tabler/icons-react";
import { Field, Form, Formik, useFormikContext } from "formik";
import { Button, ErrorAlert, Loading, SwitchField } from "src/components";
import { useMonitoringSettings, useRuntimeSettings, useSaveLogsAndMonitoring } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
import { GROUP_KEYS, isEmptyPayload, runtimeSettingsPayload } from "src/modules/RuntimeSettings";
import { showObjectSuccess } from "src/notifications";
import { LockedBadge } from "./Authentication/LockedBadge";
import { RuntimeNumber, RuntimeSwitch } from "./Runtime/fields";
import { Part, RuntimeContext, reportSaveError, runtimeContextOf, useSaveError } from "./Runtime/RuntimeSection";
import { StatusAlert } from "./StatusAlert";

const RETENTION_MIN = 7;
const RETENTION_MAX = 365;
const EDITABLE = ["traffic_enabled", "retention_days", "show_ips", "unique_visitors", "visitors_cap"];
const CAP_MIN = 1000;
const CAP_MAX = 1_000_000;
const ROTATIONS = { min: 1, max: 1000 };
const MONITORING_FIELDS = ["trafficEnabled", "retentionDays", "showIps", "uniqueVisitors", "visitorsCap"];

function Heading() {
	return (
		<h2 className="mb-3">
			<T id="settings.monitoring" />
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
	const days = Number(values.retentionDays);
	if (!Number.isInteger(days) || days < RETENTION_MIN || days > RETENTION_MAX) {
		errors.retentionDays = intl.formatMessage(
			{ id: "settings.monitoring.retention.invalid" },
			{ min: RETENTION_MIN, max: RETENTION_MAX },
		);
	}
	const rotations = Number(values.logRotations);
	if (!Number.isInteger(rotations) || rotations < ROTATIONS.min || rotations > ROTATIONS.max) {
		errors.logRotations = intl.formatMessage({ id: "settings.runtime.number.invalid" }, ROTATIONS);
	}
	const cap = Number(values.visitorsCap);
	if (values.uniqueVisitors && (!Number.isInteger(cap) || cap < CAP_MIN || cap > CAP_MAX)) {
		errors.visitorsCap = intl.formatMessage(
			{ id: "settings.monitoring.visitors-cap.invalid" },
			{ min: CAP_MIN, max: CAP_MAX },
		);
	}
	return errors;
};

// Write log files and rotations: the logs runtime settings group, saved with its own request
function LogFields() {
	return (
		<Part titleId="settings.logs.files">
			<RuntimeSwitch
				name="writeLogFiles"
				label={<T id="settings.logs.write" />}
				hint={<T id="settings.logs.write.hint" />}
			/>
			<RuntimeNumber
				name="logRotations"
				label={<T id="settings.logs.rotations" />}
				hint={<T id="settings.logs.rotations.hint" data={ROTATIONS} />}
				{...ROTATIONS}
			/>
		</Part>
	);
}

const logsApi = (values) => ({ writeLogFiles: values.writeLogFiles, logRotations: Number(values.logRotations) });

function Fields({ isLocked }) {
	const { values, setFieldValue } = useFormikContext();
	const label = (key, id) => (
		<>
			<T id={id} />
			{isLocked(key) ? <LockedBadge /> : null}
		</>
	);
	return (
		<Part titleId="settings.monitoring.statistics" last>
			<div className="divide-y">
				<SwitchField
					className="pb-3"
					id="monitoring-traffic-enabled"
					label={label("trafficEnabled", "settings.monitoring.traffic")}
					hint={<T id="settings.monitoring.traffic.hint" />}
					disabled={isLocked("trafficEnabled")}
					checked={Boolean(values.trafficEnabled)}
					onChange={(e) => setFieldValue("trafficEnabled", e.target.checked)}
				/>
				<Field name="retentionDays">
					{({ field, meta }) => (
						<div className="py-3">
							<label className="form-label" htmlFor="monitoring-retention-days">
								{label("retentionDays", "settings.monitoring.retention")}
							</label>
							<div className="row">
								<div className="col-12 col-sm-6 col-lg-4">
									<div className={`input-group${meta.error ? " has-validation" : ""}`}>
										<input
											{...field}
											id="monitoring-retention-days"
											type="number"
											inputMode="numeric"
											min={RETENTION_MIN}
											max={RETENTION_MAX}
											step={1}
											className={`form-control${meta.error ? " is-invalid" : ""}`}
											disabled={isLocked("retentionDays")}
											aria-invalid={meta.error ? "true" : undefined}
											aria-describedby="monitoring-retention-days-hint"
										/>
										<span className="input-group-text">
											<T id="settings.monitoring.retention.days" />
										</span>
										{meta.error ? <div className="invalid-feedback">{meta.error}</div> : null}
									</div>
								</div>
							</div>
							<div className="form-hint" id="monitoring-retention-days-hint">
								<T
									id="settings.monitoring.retention.hint"
									data={{ min: RETENTION_MIN, max: RETENTION_MAX }}
								/>
							</div>
						</div>
					)}
				</Field>
				<SwitchField
					className="pt-3"
					id="monitoring-show-ips"
					label={label("showIps", "settings.monitoring.show-ips")}
					hint={<T id="settings.monitoring.show-ips.hint" />}
					disabled={isLocked("showIps")}
					checked={Boolean(values.showIps)}
					onChange={(e) => setFieldValue("showIps", e.target.checked)}
				/>
				<SwitchField
					className={values.uniqueVisitors ? "py-3" : "pt-3"}
					id="monitoring-unique-visitors"
					label={label("uniqueVisitors", "settings.monitoring.unique-visitors")}
					hint={<T id="settings.monitoring.unique-visitors.hint" />}
					disabled={isLocked("uniqueVisitors")}
					checked={Boolean(values.uniqueVisitors)}
					onChange={(e) => setFieldValue("uniqueVisitors", e.target.checked)}
				/>
				{values.uniqueVisitors ? (
					<Field name="visitorsCap">
						{({ field, meta }) => (
							<div className="pt-3">
								<label className="form-label" htmlFor="monitoring-visitors-cap">
									{label("visitorsCap", "settings.monitoring.visitors-cap")}
								</label>
								<div className="row">
									<div className="col-12 col-sm-6 col-lg-4">
										<div className={`input-group${meta.error ? " has-validation" : ""}`}>
											<input
												{...field}
												id="monitoring-visitors-cap"
												type="number"
												inputMode="numeric"
												min={CAP_MIN}
												max={CAP_MAX}
												step={1}
												className={`form-control${meta.error ? " is-invalid" : ""}`}
												disabled={isLocked("visitorsCap")}
												aria-invalid={meta.error ? "true" : undefined}
												aria-describedby="monitoring-visitors-cap-hint"
											/>
											{meta.error ? <div className="invalid-feedback">{meta.error}</div> : null}
										</div>
									</div>
								</div>
								<div className="form-hint" id="monitoring-visitors-cap-hint">
									<T
										id="settings.monitoring.visitors-cap.hint"
										data={{ min: CAP_MIN, max: CAP_MAX }}
									/>
								</div>
							</div>
						)}
					</Field>
				) : null}
			</div>
		</Part>
	);
}

export default function Monitoring() {
	const { data, isPending, error } = useMonitoringSettings();
	const logsQuery = useRuntimeSettings("logs");
	const { mutateAsync: save } = useSaveLogsAndMonitoring();
	const { alert, setErrorMsg } = useSaveError();

	if (error || logsQuery.error) {
		return (
			<div className="card-body">
				<Heading />
				<ErrorAlert error={error ?? logsQuery.error} />
			</div>
		);
	}

	if (isPending || logsQuery.isPending) {
		return (
			<div className="card-body">
				<Heading />
				<Loading noLogo />
			</div>
		);
	}

	const lockedKeys = data.locked ?? [];
	const locked = new Set(lockedKeys);
	const isLocked = (key) => locked.has(key.replaceAll(/[A-Z]/gu, (c) => `_${c.toLowerCase()}`));
	const confirmKey = (ips, visitors) => {
		if (ips && visitors) return "settings.monitoring.both-off";
		return ips ? "settings.monitoring.show-ips" : "settings.monitoring.unique-visitors";
	};
	const logs = logsQuery.data;
	const logsCtx = runtimeContextOf("logs", logs);
	const allLocked = EDITABLE.every((key) => locked.has(key)) && GROUP_KEYS.logs.every((key) => logsCtx.isLocked(key));

	const initialValues = {
		trafficEnabled: Boolean(data.trafficEnabled),
		retentionDays: String(data.retentionDays),
		showIps: Boolean(data.showIps),
		uniqueVisitors: Boolean(data.uniqueVisitors),
		visitorsCap: String(data.visitorsCap ?? 100_000),
		writeLogFiles: Boolean(logs.writeLogFiles),
		logRotations: String(logs.logRotations),
	};

	const onSubmit = async (allValues, { setSubmitting, setFieldError }) => {
		setErrorMsg(null);
		const logsPayload = runtimeSettingsPayload("logs", logsApi(allValues), logs.locked, logs);
		const values = Object.fromEntries(MONITORING_FIELDS.map((key) => [key, allValues[key]]));
		const monitoringChanged = MONITORING_FIELDS.some((key) => values[key] !== initialValues[key]);
		const payload = {
			...values,
			retentionDays: Number(values.retentionDays),
			visitorsCap: Number(values.visitorsCap),
			locked: lockedKeys,
		};
		if (!values.uniqueVisitors) delete payload.visitorsCap;
		const logsBody = isEmptyPayload(logsPayload) ? null : logsPayload;
		const monitoringBody = monitoringChanged ? payload : null;
		// nothing to send: no request and no success message
		if (!(logsBody || monitoringBody)) {
			setSubmitting(false);
			return;
		}
		const report = (err) =>
			reportSaveError("logs", err, {
				setErrorMsg,
				setFieldError,
				lead: err?.logsSaved ? <T id="settings.logs.saved-monitoring-failed" /> : null,
			});
		// the caches (and with them the form) are refreshed only after both parts are saved
		const run = async () => {
			await save({ logs: logsBody, monitoring: monitoringBody });
			showObjectSuccess("setting", "saved");
		};
		// switching visitor IPs or unique visitors off deletes the stored data: ask first, once for both
		const ipsOff = monitoringChanged && data.showIps && !values.showIps && !isLocked("showIps");
		const visitorsOff =
			monitoringChanged && data.uniqueVisitors && !values.uniqueVisitors && !isLocked("uniqueVisitors");
		if (ipsOff || visitorsOff) {
			const key = confirmKey(ipsOff, visitorsOff);
			setSubmitting(false);
			showDeleteConfirmModal({
				title: <T id={`${key}.confirm`} />,
				children:
					ipsOff && visitorsOff ? (
						<>
							<T id="settings.monitoring.both-off.confirm.body" />
							<ul className="mt-2 mb-0 text-start">
								<li>
									<T id="settings.monitoring.show-ips.confirm.item" />
								</li>
								<li>
									<T id="settings.monitoring.unique-visitors.confirm.item" />
								</li>
							</ul>
						</>
					) : (
						<T id={`${key}.confirm.body`} />
					),
				confirmLabel: <T id="settings.monitoring.show-ips.confirm.button" />,
				// a failure shows in the modal and, like a direct save, inline and on the field
				onConfirm: async () => {
					try {
						await run();
					} catch (err) {
						report(err);
						throw err;
					}
				},
				invalidations: [],
			});
			return;
		}
		try {
			await run();
		} catch (err) {
			report(err);
		}
		setSubmitting(false);
	};

	return (
		<Formik enableReinitialize initialValues={initialValues} validate={validate} onSubmit={onSubmit}>
			<Form className="d-flex flex-column flex-fill" noValidate>
				<div className="card-body flex-fill">
					<Heading />
					{alert}
					{locked.size > 0 || logsCtx.anyLocked ? (
						<StatusAlert variant="info" icon={IconInfoCircle} id="settings.authentication.status.locked" />
					) : null}
					<RuntimeContext.Provider value={logsCtx}>
						<LogFields />
					</RuntimeContext.Provider>
					<Fields isLocked={isLocked} />
				</div>
				<div className="card-footer text-end">
					<SaveButton allLocked={allLocked} />
				</div>
			</Form>
		</Formik>
	);
}
