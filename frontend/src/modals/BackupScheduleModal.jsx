import cn from "clsx";
import { Field, Form, Formik, useFormikContext } from "formik";
import { useId, useState } from "react";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	Loading,
	PasswordInput,
	SwitchField,
	TypeTree,
} from "src/components";
import { DirtyTracker, useBackupTypes, useSaveBackupSchedule, useUnsavedChangesGuard } from "src/hooks";
import { intl, T } from "src/locale";
import {
	initialValues,
	PROTECTIONS,
	scheduleErrors,
	scheduleOf,
	timingValid,
	toPayload,
	weekdayName,
} from "src/modules/BackupSchedules";
import EasyModal from "src/modules/easyModal";
import { FREQUENCIES, nextRun, zoneOf } from "src/modules/ScheduleTime";
import { showObjectSuccess } from "src/notifications";

/**
 * Add a backup schedule (null) or edit one (the row of the list)
 */
const showBackupScheduleModal = (schedule) => {
	EasyModal.show(BackupScheduleModal, { schedule });
};

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

// the labels of the fields the error note names that have no label of their own name in the form
const NOTE_LABELS = { types: "settings.backup.schedule.include" };

// an error is shown once the field was left or a save was tried
const shownError = (form, name) =>
	form.errors[name] && (form.touched[name] || form.submitCount > 0) ? form.errors[name] : null;

function InputField({ name, id, labelId, hintId, className, ...inputProps }) {
	return (
		<Field name={name}>
			{({ field, form }) => {
				const error = shownError(form, name);
				const hint = hintId ? `${id}-hint` : undefined;
				return (
					<div className={className}>
						<label htmlFor={id} className="form-label">
							<T id={labelId} />
						</label>
						<input
							{...field}
							{...inputProps}
							id={id}
							className={cn("form-control", error && "is-invalid")}
							aria-invalid={error ? "true" : undefined}
							aria-describedby={cn(error && `${id}-error`, hint) || undefined}
						/>
						{error ? (
							<div className="invalid-feedback" id={`${id}-error`}>
								{error}
							</div>
						) : null}
						{hintId ? (
							<div className="form-hint" id={hint}>
								<T id={hintId} />
							</div>
						) : null}
					</div>
				);
			}}
		</Field>
	);
}

function SelectField({ name, id, labelId, className, children }) {
	return (
		<Field name={name}>
			{({ field, form }) => {
				const error = shownError(form, name);
				return (
					<div className={className}>
						<label htmlFor={id} className="form-label">
							<T id={labelId} />
						</label>
						<select
							{...field}
							id={id}
							className={cn("form-select", error && "is-invalid")}
							aria-invalid={error ? "true" : undefined}
							aria-describedby={error ? `${id}-error` : undefined}
						>
							{children}
						</select>
						{error ? (
							<div className="invalid-feedback" id={`${id}-error`}>
								{error}
							</div>
						) : null}
					</div>
				);
			}}
		</Field>
	);
}

// "Next run: Monday, 2 November 2026, 03:00 (Europe/Berlin)", computed with the backend's rules in the server's zone
function NextRun({ timeZone, lastRunAt }) {
	const { values } = useFormikContext();
	if (!(values.enabled && timingValid(values))) return null;
	let when;
	try {
		when = new Intl.DateTimeFormat(intl.locale, {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
			timeZone,
		}).format(nextRun(scheduleOf(values, lastRunAt), new Date(), zoneOf(timeZone)));
	} catch {
		return null;
	}
	return (
		<div className="form-hint mt-2">
			<T id="settings.backup.schedule.next-run" data={{ when, zone: timeZone }} />
		</div>
	);
}

function TimingFields({ baseId, timeZone, lastRunAt }) {
	const { values } = useFormikContext();
	const { frequency } = values;
	return (
		<div className="mb-3">
			<div className="row g-2">
				<SelectField
					name="frequency"
					id={`${baseId}-frequency`}
					labelId="settings.backup.schedule.when"
					className="col-12 col-md-4"
				>
					{FREQUENCIES.map((value) => (
						<option key={value} value={value}>
							{intl.formatMessage({ id: `settings.backup.schedule.frequency.${value}` })}
						</option>
					))}
				</SelectField>
				{frequency === "hours" ? (
					<InputField
						name="everyHours"
						id={`${baseId}-every-hours`}
						labelId="settings.backup.schedule.every-hours"
						className="col-6 col-md-4"
						type="number"
						min={1}
						max={24}
						required
					/>
				) : null}
				{frequency === "weekly" ? (
					<SelectField
						name="weekday"
						id={`${baseId}-weekday`}
						labelId="settings.backup.schedule.weekday"
						className="col-6 col-md-4"
					>
						{WEEKDAYS.map((weekday) => (
							<option key={weekday} value={String(weekday)}>
								{weekdayName(weekday, intl.locale)}
							</option>
						))}
					</SelectField>
				) : null}
				{frequency === "monthly" ? (
					<InputField
						name="monthDay"
						id={`${baseId}-month-day`}
						labelId="settings.backup.schedule.month-day"
						className="col-6 col-md-4"
						type="number"
						min={1}
						max={28}
						required
					/>
				) : null}
				{frequency === "hours" ? null : (
					<InputField
						name="time"
						id={`${baseId}-time`}
						labelId="settings.backup.schedule.time"
						className="col-6 col-md-4"
						type="time"
						required
					/>
				)}
			</div>
			<NextRun timeZone={timeZone} lastRunAt={lastRunAt} />
		</div>
	);
}

function ProtectionField({ disabled }) {
	return (
		<Field name="protection">
			{({ field, form }) => {
				const error = shownError(form, "protection");
				return (
					<fieldset className="mb-3">
						<legend className="form-label">
							<T id="settings.backup.schedule.protection" />
						</legend>
						<div className="form-selectgroup form-selectgroup-boxes d-flex flex-column">
							{PROTECTIONS.map((protection) => (
								<label key={protection} className="form-selectgroup-item flex-fill">
									<input
										type="radio"
										name={field.name}
										value={protection}
										className="form-selectgroup-input"
										checked={field.value === protection}
										onChange={field.onChange}
										onBlur={field.onBlur}
										disabled={disabled}
									/>
									<span className="form-selectgroup-label d-flex align-items-center p-3 text-start">
										<span className="me-3">
											<span className="form-selectgroup-check" />
										</span>
										<span>
											<span className="d-block fw-medium">
												<T id={`settings.backup.schedule.protection.${protection}`} />
											</span>
											<span className="d-block text-secondary small">
												<T id={`settings.backup.schedule.protection.${protection}.hint`} />
											</span>
										</span>
									</span>
								</label>
							))}
						</div>
						{error ? <div className="invalid-feedback d-block">{error}</div> : null}
					</fieldset>
				);
			}}
		</Field>
	);
}

function PassphraseField({ name, id, labelId, hintId }) {
	const { submitCount } = useFormikContext();
	return (
		<Field name={name}>
			{({ field, meta }) => (
				<div className="mb-3">
					<PasswordInput
						{...field}
						id={id}
						label={<T id={labelId} />}
						autoComplete="new-password"
						error={meta.touched || submitCount > 0 ? meta.error : undefined}
						aria-describedby={hintId ? `${id}-hint` : undefined}
					/>
					{hintId ? (
						<div className="form-hint" id={`${id}-hint`}>
							<T id={hintId} />
						</div>
					) : null}
				</div>
			)}
		</Field>
	);
}

function ScheduleForm({ schedule, types, errorMsg, onCloseError, close }) {
	const { values, setFieldValue, setFieldTouched, errors, touched, submitCount, isSubmitting } = useFormikContext();
	const baseId = useId();
	// the server's zone; the browser's while the server does not say
	const timeZone = types.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
	const typesError = errors.types && (touched.types || submitCount > 0) ? errors.types : null;
	return (
		<>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T id={schedule ? "settings.backup.schedule.title.edit" : "settings.backup.schedule.title.add"} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<ErrorAlert onClose={onCloseError}>{errorMsg}</ErrorAlert>
				<InputField
					name="name"
					id={`${baseId}-name`}
					labelId="settings.backup.schedule.name"
					className="mb-3"
					type="text"
					maxLength={60}
					autoComplete="off"
					required
				/>
				<Field name="enabled" type="checkbox">
					{({ field }) => (
						<SwitchField
							{...field}
							id={`${baseId}-enabled`}
							className="mb-3"
							label={<T id="settings.backup.schedule.enabled" />}
							disabled={isSubmitting}
						/>
					)}
				</Field>
				<TimingFields baseId={baseId} timeZone={timeZone} lastRunAt={schedule?.lastRunAt ?? null} />
				{/* a wrapper, so a blocked save focuses the parts and not the first field of the window */}
				<div>
					<TypeTree
						label={<T id="settings.backup.schedule.include" />}
						categories={types.categories}
						counts={types.counts}
						certificateKinds={types.certificateKinds}
						selected={values.types}
						onChange={(selected) => {
							void setFieldValue("types", selected);
							void setFieldTouched("types", true, false);
						}}
						disabled={isSubmitting}
					/>
					{typesError ? <div className="invalid-feedback d-block mt-n2 mb-3">{typesError}</div> : null}
				</div>
				<ProtectionField disabled={isSubmitting} />
				{values.protection === "passphrase" ? (
					<div className="row">
						<div className="col-12 col-md-6">
							<PassphraseField
								name="passphrase"
								id={`${baseId}-passphrase`}
								labelId="settings.backup.passphrase"
								hintId={
									schedule?.passphraseSet ? "settings.backup.schedule.passphrase.keep" : undefined
								}
							/>
						</div>
						<div className="col-12 col-md-6">
							<PassphraseField
								name="passphraseRepeat"
								id={`${baseId}-passphrase-repeat`}
								labelId="settings.backup.passphrase.repeat"
							/>
						</div>
					</div>
				) : null}
				<InputField
					name="keep"
					id={`${baseId}-keep`}
					labelId="settings.backup.schedule.keep"
					hintId="settings.backup.schedule.keep.hint"
					type="number"
					min={1}
					max={100}
					required
				/>
			</AppModal.Body>
			<AppModal.Footer>
				<Button className="btn-link link-secondary" onClick={close} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<FormSubmit
					className="ms-auto"
					edit={Boolean(schedule)}
					color="primary"
					labels={NOTE_LABELS}
					isLoading={isSubmitting}
					disabled={isSubmitting}
				>
					<T id="save" />
				</FormSubmit>
			</AppModal.Footer>
		</>
	);
}

/**
 * The add/edit window of a backup schedule: name, enabled, when it runs (with the next run in the server's time
 * zone), what it includes, its protection and how many files it keeps
 */
const BackupScheduleModal = EasyModal.create(({ schedule, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data: types, isPending, error } = useBackupTypes();
	const save = useSaveBackupSchedule();
	const [errorMsg, setErrorMsg] = useState(null);
	const editing = Boolean(schedule);

	const validate = (values) =>
		Object.fromEntries(
			Object.entries(scheduleErrors(values, { editingWithPassphrase: Boolean(schedule?.passphraseSet) })).map(
				([field, id]) => [field, intl.formatMessage({ id })],
			),
		);

	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			await save.mutateAsync({ id: schedule?.id, ...toPayload(values, { editing }) });
			showObjectSuccess("backup-schedule", "saved");
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={save.isPending ? undefined : close} size="lg" backdrop="static">
			{error ? <ErrorAlert error={error} className="m-3" /> : null}
			{isPending ? <Loading noLogo /> : null}
			{types ? (
				<Formik
					initialValues={initialValues(schedule, types.categories)}
					validate={validate}
					onSubmit={onSubmit}
				>
					<Form noValidate>
						<DirtyTracker dirtyRef={dirtyRef} />
						<ScheduleForm
							schedule={schedule}
							types={types}
							errorMsg={errorMsg}
							onCloseError={() => setErrorMsg(null)}
							close={close}
						/>
					</Form>
				</Formik>
			) : null}
		</AppModal>
	);
});

export { showBackupScheduleModal };
