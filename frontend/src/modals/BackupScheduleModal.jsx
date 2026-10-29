import cn from "clsx";
import { useCallback, useId, useState } from "react";
import { useController, useFormContext, useFormState, useWatch } from "react-hook-form";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	Loading,
	PASSPHRASE_FIELDS,
	PasswordInput,
	SwitchField,
	TypeTree,
	useAppForm,
	useRecheckDependent,
} from "src/components";
import { DirtyTracker, useBackupTypes, useSaveBackupSchedule, useUnsavedChangesGuard } from "src/hooks";
import { intl, T } from "src/locale";
import {
	hiddenTimingFields,
	initialValues,
	PROTECTIONS,
	scheduleErrors,
	scheduleOf,
	timingValid,
	toPayload,
	weekdayName,
} from "src/modules/BackupSchedules";
import EasyModal from "src/modules/easyModal";
import { translateErrors } from "src/modules/HookForm";
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

// the fields in form order (the timing fields as the window shows them), for the note and the first-error focus
const FIELD_ORDER = [
	"name",
	"enabled",
	"frequency",
	"everyHours",
	"weekday",
	"monthDay",
	"time",
	"types",
	"protection",
	"passphrase",
	"passphraseRepeat",
	"keep",
];

// the message of a field, while React Hook Form holds one (it shows once the field was left or a save was tried)
const useFieldError = (name) => useFormState({ name }).errors[name]?.message ?? null;

function InputField({ name, id, labelId, hintId, className, ...inputProps }) {
	const { register } = useFormContext();
	const error = useFieldError(name);
	const hint = hintId ? `${id}-hint` : undefined;
	return (
		<div className={className}>
			<label htmlFor={id} className="form-label">
				<T id={labelId} />
			</label>
			<input
				{...register(name, { valueAsNumber: inputProps.type === "number" })}
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
}

function SelectField({ name, id, labelId, className, registerOptions, children }) {
	const { register } = useFormContext();
	const error = useFieldError(name);
	return (
		<div className={className}>
			<label htmlFor={id} className="form-label">
				<T id={labelId} />
			</label>
			<select
				{...register(name, registerOptions)}
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
}

// "Next run: Monday, 2 November 2026, 03:00 (Europe/Berlin)", computed with the backend's rules in the server's zone
function NextRun({ timeZone, lastRunAt }) {
	const values = useWatch();
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
	const { clearErrors } = useFormContext();
	const frequency = useWatch({ name: "frequency" });
	return (
		<div className="mb-3">
			{/* on phones the field next to "When" takes the full row when it is alone and half of it beside a second one */}
			<div className="row g-2">
				<SelectField
					name="frequency"
					id={`${baseId}-frequency`}
					labelId="settings.backup.schedule.when"
					className="col-12 col-md-4"
					// the fields this frequency hides take their messages with them
					registerOptions={{ onChange: (event) => clearErrors(hiddenTimingFields(event.target.value)) }}
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
						className="col-12 col-md-4"
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
						className={frequency === "daily" ? "col-12 col-md-4" : "col-6 col-md-4"}
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
	const { register, clearErrors } = useFormContext();
	const error = useFieldError("protection");
	const field = register("protection", {
		onChange: (event) => {
			if (event.target.value !== "passphrase") clearErrors(PASSPHRASE_FIELDS);
		},
	});
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
							{...field}
							value={protection}
							className="form-selectgroup-input"
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
}

// a new passphrase re-checks the repeat
function PassphraseField({ name, id, labelId, hintId }) {
	const { register } = useFormContext();
	const recheckRepeat = useRecheckDependent("passphraseRepeat");
	const error = useFieldError(name);
	return (
		<div className="mb-3">
			<PasswordInput
				{...register(name, name === "passphrase" ? { onChange: recheckRepeat } : undefined)}
				id={id}
				label={<T id={labelId} />}
				autoComplete="new-password"
				error={error ?? undefined}
				aria-describedby={hintId ? `${id}-hint` : undefined}
			/>
			{hintId ? (
				<div className="form-hint" id={`${id}-hint`}>
					<T id={hintId} />
				</div>
			) : null}
		</div>
	);
}

// the types to back up: a controller; a change is checked at once (unticking the last box names the field right
// away), the field counts as left when the focus leaves the tree
function TypesField({ types, disabled }) {
	const { trigger } = useFormContext();
	const { field, fieldState } = useController({ name: "types" });
	const typesError = fieldState.error?.message ?? null;
	return (
		// a wrapper, so a refused save focuses the first box of the tree and leaving the tree marks the field as left
		// biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: onBlur only catches the focus leaving the boxes inside
		<div
			ref={(element) =>
				field.ref(element ? { focus: () => element.querySelector("input:not([disabled])")?.focus() } : null)
			}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) field.onBlur();
			}}
		>
			<TypeTree
				label={<T id="settings.backup.schedule.include" />}
				categories={types.categories}
				counts={types.counts}
				certificateKinds={types.certificateKinds}
				selected={field.value}
				onChange={(selected) => {
					field.onChange(selected);
					void trigger("types");
				}}
				disabled={disabled}
			/>
			{typesError ? <div className="invalid-feedback d-block mt-n2 mb-3">{typesError}</div> : null}
		</div>
	);
}

function ScheduleForm({ schedule, types, errorMsg, onCloseError, close }) {
	const { register } = useFormContext();
	const { isSubmitting } = useFormState();
	const protection = useWatch({ name: "protection" });
	const baseId = useId();
	// the server's zone; the browser's while the server does not say
	const timeZone = types.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
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
				<SwitchField
					{...register("enabled")}
					id={`${baseId}-enabled`}
					className="mb-3"
					label={<T id="settings.backup.schedule.enabled" />}
					disabled={isSubmitting}
				/>
				<TimingFields baseId={baseId} timeZone={timeZone} lastRunAt={schedule?.lastRunAt ?? null} />
				<TypesField types={types} disabled={isSubmitting} />
				<ProtectionField disabled={isSubmitting} />
				{protection === "passphrase" ? (
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

// the form, mounted once the types are loaded: its defaultValues are complete from the first render, and a refetch
// of the types does not reset it
function ScheduleEditor({ schedule, types, onSubmit, dirtyRef, ...formProps }) {
	const editingWithPassphrase = Boolean(schedule?.passphraseSet);
	const validate = useCallback(
		(values) => translateErrors(scheduleErrors(values, { editingWithPassphrase }), intl),
		[editingWithPassphrase],
	);
	const methods = useAppForm({ defaultValues: initialValues(schedule, types.categories), validate });
	return (
		<HookForm methods={methods} onSubmit={onSubmit} fieldOrder={FIELD_ORDER}>
			<DirtyTracker dirtyRef={dirtyRef} />
			<ScheduleForm schedule={schedule} types={types} {...formProps} />
		</HookForm>
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
				<ScheduleEditor
					schedule={schedule}
					types={types}
					onSubmit={onSubmit}
					dirtyRef={dirtyRef}
					errorMsg={errorMsg}
					onCloseError={() => setErrorMsg(null)}
					close={close}
				/>
			) : null}
		</AppModal>
	);
});

export { showBackupScheduleModal };
