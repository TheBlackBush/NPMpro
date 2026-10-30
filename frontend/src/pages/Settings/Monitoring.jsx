import { IconExternalLink, IconInfoCircle } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { ErrorAlert, HookForm, Loading, SwitchField, useAppForm } from "src/components";
import { useMonitoringSettings, useRuntimeSettings, useSaveLogsAndMonitoring, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
import { GROUP_KEYS } from "src/modules/RuntimeSettings";
import {
	KEEP_DAYS,
	lockedIn,
	monitoringConfirmKey,
	monitoringRequest,
	monitoringValidate,
	monitoringValues,
	RETENTION,
	ROTATIONS,
	VISITORS_CAP,
} from "src/modules/SettingsForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { LockedBadge } from "./Authentication/LockedBadge";
import { RuntimeNumber, RuntimeSelect, RuntimeSwitch } from "./Runtime/fields";
import {
	Part,
	RestartPendingAlert,
	RuntimeContext,
	reportSaveError,
	runtimeContextOf,
	useRuntimeSection,
	useSaveError,
} from "./Runtime/RuntimeSection";
import { SaveBar } from "./SaveBar";
import { StatusAlert } from "./StatusAlert";

const EDITABLE = ["traffic_enabled", "retention_days", "show_ips", "unique_visitors", "visitors_cap"];
const ANONYMIZE_LEVELS = ["off", "1", "2", "3"];

function Heading() {
	return (
		<h2 className="mb-3">
			<T id="settings.monitoring" />
		</h2>
	);
}

function SaveButton({ allLocked }) {
	const { isDirty } = useFormState();
	return <SaveBar disabled={allLocked || !isDirty} reasonId={allLocked ? "settings.save.all-locked" : undefined} />;
}

// Write log files and rotations: the logs runtime settings group (with GoAccess below), saved with its own request
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

// GoAccess is its own tool with its own report, applied after a restart; the link shows while it runs
// the GoAccess options (GOACLA flags), while the report is switched on or GOA is set by env
function GoAccessOptions() {
	const anonymize = ANONYMIZE_LEVELS.map((value) => ({
		value,
		label: intl.formatMessage({ id: `settings.logs.goaccess.anonymize.${value}` }),
	}));
	return (
		<>
			<RuntimeNumber
				name="goaccessKeepDays"
				label={<T id="settings.logs.goaccess.keep-days" />}
				hint={<T id="settings.logs.goaccess.keep-days.hint" data={KEEP_DAYS} />}
				unit={<T id="settings.monitoring.retention.days" />}
				{...KEEP_DAYS}
			/>
			<RuntimeSelect
				name="goaccessAnonymize"
				label={<T id="settings.logs.goaccess.anonymize" />}
				hint={<T id="settings.logs.goaccess.anonymize.hint" />}
				options={anonymize}
			/>
			<RuntimeSwitch
				name="goaccessDropQueryStrings"
				label={<T id="settings.logs.goaccess.drop-query-strings" />}
				hint={<T id="settings.logs.goaccess.drop-query-strings.hint" />}
			/>
			<RuntimeSwitch
				name="goaccessRealOs"
				label={<T id="settings.logs.goaccess.real-os" />}
				hint={<T id="settings.logs.goaccess.real-os.hint" />}
			/>
			<RuntimeSwitch
				name="goaccessResolveHosts"
				label={<T id="settings.logs.goaccess.resolve-hosts" />}
				hint={<T id="settings.logs.goaccess.resolve-hosts.hint" />}
			/>
		</>
	);
}

function GoAccessFields() {
	const { data: user } = useUser("me");
	const goaccess = useWatch({ name: "goaccess" });
	const { isLocked } = useRuntimeSection();
	return (
		<Part titleId="settings.logs.goaccess.title">
			<RuntimeSwitch
				name="goaccess"
				label={<T id="settings.logs.goaccess" />}
				hint={<T id="settings.logs.goaccess.hint" />}
			/>
			{goaccess || isLocked("goaccess") ? <GoAccessOptions /> : null}
			{user?.goaccess ? (
				<a href="/goaccess" target="_blank" rel="noopener noreferrer" className="link-primary">
					<IconExternalLink size={16} className="me-1" aria-hidden="true" />
					<T id="settings.logs.goaccess.open" />
				</a>
			) : null}
		</Part>
	);
}

/**
 * The "Also delete the stored statistics" choice of one confirm dialog, shared by its checkbox and its button label
 * (both rendered inside the modal) and read by onConfirm
 */
const createDeleteChoice = () => {
	let value = false;
	const listeners = new Set();
	return {
		get: () => value,
		set: (next) => {
			value = next;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
};

const useDeleteChoice = (choice) => useSyncExternalStore(choice.subscribe, choice.get);

/**
 * Confirm dialog body for switching traffic statistics off: what stays stored, what the other switches delete, and
 * the unticked "Also delete the stored statistics" checkbox
 */
function TrafficOffConfirm({ days, ipsOff, visitorsOff, choice }) {
	const checked = useDeleteChoice(choice);
	return (
		<>
			<T id="settings.monitoring.traffic.confirm.body" data={{ days }} />
			{ipsOff || visitorsOff ? (
				<>
					<div className="mt-2">
						<T id="settings.monitoring.traffic.confirm.also" />
					</div>
					<ul className="mt-2 mb-0 text-start">
						{ipsOff ? (
							<li>
								<T id="settings.monitoring.show-ips.confirm.item" />
							</li>
						) : null}
						{visitorsOff ? (
							<li>
								<T id="settings.monitoring.unique-visitors.confirm.item" />
							</li>
						) : null}
					</ul>
				</>
			) : null}
			<label className="form-check text-start mt-3 mb-0">
				<input
					className="form-check-input"
					type="checkbox"
					checked={checked}
					onChange={(e) => choice.set(e.target.checked)}
				/>
				<span className="form-check-label">
					<T id="settings.monitoring.traffic.confirm.delete" />
				</span>
			</label>
		</>
	);
}

// "Turn off and delete" when anything is deleted, "Turn off" when traffic statistics only go off and are kept
function TrafficOffLabel({ choice, deletesOther }) {
	const deleting = useDeleteChoice(choice) || deletesOther;
	return (
		<T
			id={deleting ? "settings.monitoring.show-ips.confirm.button" : "settings.monitoring.traffic.confirm.button"}
		/>
	);
}

// the dialog body when only visitor IPs and/or unique visitors are switched off
function DataOffConfirm({ ipsOff, visitorsOff, confirmKey }) {
	if (!(ipsOff && visitorsOff)) return <T id={`${confirmKey}.confirm.body`} />;
	return (
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
	);
}

/**
 * A number of the traffic statistics with its label, the lock badge and its hint
 */
function StatisticsNumber({ name, id, labelId, hint, range, unit, isLocked, className }) {
	const { register } = useFormContext();
	const { errors } = useFormState({ name, exact: true });
	const error = errors[name]?.message ?? null;
	return (
		<div className={className}>
			<label className="form-label" htmlFor={id}>
				<T id={labelId} />
				{isLocked(name) ? <LockedBadge /> : null}
			</label>
			<div className="row">
				<div className="col-12 col-sm-6 col-lg-4">
					<div className={`input-group${error ? " has-validation" : ""}`}>
						<input
							{...register(name)}
							id={id}
							type="number"
							inputMode="numeric"
							min={range.min}
							max={range.max}
							step={1}
							className={`form-control${error ? " is-invalid" : ""}`}
							disabled={isLocked(name)}
							aria-invalid={error ? "true" : undefined}
							aria-describedby={`${id}-hint`}
						/>
						{unit}
						{error ? <div className="invalid-feedback">{error}</div> : null}
					</div>
				</div>
			</div>
			<div className="form-hint" id={`${id}-hint`}>
				{hint}
			</div>
		</div>
	);
}

function Fields({ isLocked }) {
	const { register, clearErrors } = useFormContext();
	const uniqueVisitors = useWatch({ name: "uniqueVisitors" });
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
					{...register("trafficEnabled")}
					className="pb-3"
					id="monitoring-traffic-enabled"
					label={label("trafficEnabled", "settings.monitoring.traffic")}
					hint={<T id="settings.monitoring.traffic.hint" />}
					disabled={isLocked("trafficEnabled")}
				/>
				<StatisticsNumber
					name="retentionDays"
					id="monitoring-retention-days"
					labelId="settings.monitoring.retention"
					hint={<T id="settings.monitoring.retention.hint" data={RETENTION} />}
					range={RETENTION}
					unit={
						<span className="input-group-text">
							<T id="settings.monitoring.retention.days" />
						</span>
					}
					isLocked={isLocked}
					className="py-3"
				/>
				<SwitchField
					{...register("showIps")}
					className="pt-3"
					id="monitoring-show-ips"
					label={label("showIps", "settings.monitoring.show-ips")}
					hint={<T id="settings.monitoring.show-ips.hint" />}
					disabled={isLocked("showIps")}
				/>
				<SwitchField
					{...register("uniqueVisitors", {
						// the cap is hidden while unique visitors are off: its message goes with it
						onChange: (event) => {
							if (!event.target.checked) clearErrors("visitorsCap");
						},
					})}
					className={uniqueVisitors ? "py-3" : "pt-3"}
					id="monitoring-unique-visitors"
					label={label("uniqueVisitors", "settings.monitoring.unique-visitors")}
					hint={<T id="settings.monitoring.unique-visitors.hint" />}
					disabled={isLocked("uniqueVisitors")}
				/>
				{uniqueVisitors ? (
					<StatisticsNumber
						name="visitorsCap"
						id="monitoring-visitors-cap"
						labelId="settings.monitoring.visitors-cap"
						hint={<T id="settings.monitoring.visitors-cap.hint" data={VISITORS_CAP} />}
						range={VISITORS_CAP}
						isLocked={isLocked}
						className="pt-3"
					/>
				) : null}
			</div>
		</Part>
	);
}

/**
 * The form of the loaded settings: the saved settings are its values, also after a save or a refetch (new settings
 * replace every field)
 */
function MonitoringForm({ data, logs }) {
	const { mutateAsync: save } = useSaveLogsAndMonitoring();
	const { alert, setErrorMsg } = useSaveError();
	const lockedKeys = data.locked ?? [];
	const isLocked = lockedIn(lockedKeys);
	const logsCtx = runtimeContextOf("logs", logs);
	const allLocked =
		EDITABLE.every((key) => lockedKeys.includes(key)) && GROUP_KEYS.logs.every((key) => logsCtx.isLocked(key));
	const saved = monitoringValues(data, logs);
	const methods = useAppForm({
		defaultValues: saved,
		values: saved,
		keepEdits: false,
		validate: monitoringValidate(validations, logs.locked ?? []),
	});

	const onSubmit = async (values) => {
		setErrorMsg(null);
		const request = monitoringRequest(values, data, logs);
		// nothing to send: no request and no success message
		if (!(request.logs || request.monitoring)) return;
		const report = (err) =>
			reportSaveError("logs", err, {
				setErrorMsg,
				setError: methods.setError,
				lead: err?.logsSaved ? <T id="settings.logs.saved-monitoring-failed" /> : null,
			});
		// the caches (and with them the form) are refreshed only after both parts are saved
		const run = async (deleteStats = false) => {
			await save({
				logs: request.logs,
				monitoring: deleteStats ? { ...request.monitoring, deleteStats } : request.monitoring,
			});
			showObjectSuccess("setting", "saved");
		};
		// switching traffic statistics, visitor IPs or unique visitors off: ask first, once for all of them
		// (visitor IPs and unique visitors delete their stored data, traffic statistics offer to delete theirs); the
		// save ends here, the dialog saves
		const { trafficOff, ipsOff, visitorsOff } = request;
		if (trafficOff || ipsOff || visitorsOff) {
			const key = monitoringConfirmKey(ipsOff, visitorsOff);
			const choice = createDeleteChoice();
			showDeleteConfirmModal({
				title: <T id={trafficOff ? "settings.monitoring.traffic.confirm" : `${key}.confirm`} />,
				children: trafficOff ? (
					<TrafficOffConfirm
						days={data.retentionDays}
						ipsOff={ipsOff}
						visitorsOff={visitorsOff}
						choice={choice}
					/>
				) : (
					<DataOffConfirm ipsOff={ipsOff} visitorsOff={visitorsOff} confirmKey={key} />
				),
				confirmLabel: trafficOff ? (
					<TrafficOffLabel choice={choice} deletesOther={ipsOff || visitorsOff} />
				) : (
					<T id="settings.monitoring.show-ips.confirm.button" />
				),
				// a failure shows in the modal and, like a direct save, inline and on the field
				onConfirm: async () => {
					try {
						await run(choice.get());
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
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="d-flex flex-column flex-fill">
			<div className="card-body flex-fill">
				<Heading />
				{alert}
				{lockedKeys.length > 0 || logsCtx.anyLocked ? (
					<StatusAlert variant="info" icon={IconInfoCircle} id="settings.authentication.status.locked" />
				) : null}
				<RestartPendingAlert data={logs} />
				<RuntimeContext.Provider value={logsCtx}>
					<LogFields />
					<GoAccessFields />
				</RuntimeContext.Provider>
				<Fields isLocked={isLocked} />
			</div>
			<SaveButton allLocked={allLocked} />
		</HookForm>
	);
}

export default function Monitoring() {
	const { data, isPending, error } = useMonitoringSettings();
	const logsQuery = useRuntimeSettings("logs");

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

	return <MonitoringForm data={data} logs={logsQuery.data} />;
}
