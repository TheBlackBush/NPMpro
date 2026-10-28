import {
	IconCalendarTime,
	IconDotsVertical,
	IconEdit,
	IconPlayerPause,
	IconPlayerPlay,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import {
	createColumnHelper,
	createSortedRowModel,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { useId, useMemo, useState } from "react";
import { deleteBackupSchedule } from "src/api/backend";
import { Button, EmptyData, ErrorAlert, Loading } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { useBackupSchedules, useBackupTypes, useRunBackupSchedule, useSaveBackupSchedule } from "src/hooks";
import { intl, T } from "src/locale";
import { showBackupScheduleModal, showDeleteConfirmModal } from "src/modals";
import { formatInZone, lastRunSize, scheduleStatus, timingText } from "src/modules/BackupSchedules";
import { contentLabels } from "src/modules/BackupTypes";
import { formatBytes } from "src/modules/Monitoring";
import { ADMIN, VIEW } from "src/modules/Permissions";
import { showApiError, showError, showObjectSuccess, showSuccess } from "src/notifications";
import { WrapBelowLg } from "./WrapBelowLg";

const label = (id, values) => intl.formatMessage({ id }, values);

const features = tableFeatures({
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric, datetime: sortFn_datetime, text: sortFn_text },
});

const contentLabelId = ({ kind, id }) =>
	kind === "category" ? `settings.backup.category.${id}` : `settings.backup.type.${id}`;

const contentsText = (categories, types) =>
	contentLabels(categories, types ?? [])
		.map((item) => label(contentLabelId(item)))
		.join(", ");

// a date and time in the server's zone, as the schedule's own times ("Daily at 03:00")
const formatTime = (value, timeZone) => formatInZone(value, intl.locale, timeZone);

const lastRunText = (schedule, timeZone) =>
	schedule.lastRunAt
		? [lastRunSize(schedule) ? formatBytes(lastRunSize(schedule)) : null, formatTime(schedule.lastRunAt, timeZone)]
				.filter(Boolean)
				.join(", ")
		: label("settings.backup.schedule.never");

function Contents({ categories, types }) {
	return (
		<div className="badge-list">
			{contentLabels(categories, types ?? []).map((item) => (
				<span key={`${item.kind}-${item.id}`} className="badge bg-secondary-lt text-wrap text-start">
					<T id={contentLabelId(item)} />
				</span>
			))}
		</div>
	);
}

function StatusBadge({ schedule, timeZone }) {
	const status = scheduleStatus(schedule);
	// the error of a failed last run (paused too): on phones under the badges, on wider screens in the Last run column
	const error =
		schedule.lastStatus === "failed" && schedule.lastError ? (
			<div className="small text-danger text-break mt-1 d-md-none">{schedule.lastError}</div>
		) : null;
	if (status === "paused") {
		return (
			<>
				<span className="badge bg-secondary-lt">
					<T id="settings.backup.schedule.paused" />
				</span>
				{error}
			</>
		);
	}
	// a failed schedule still runs again: "Failed" and its next run
	return (
		<>
			<div className="badge-list">
				{status === "failed" ? (
					<span className="badge bg-red-lt text-wrap text-start" title={schedule.lastError ?? undefined}>
						<T id="settings.backup.schedule.failed" />
					</span>
				) : null}
				{schedule.nextRunAt ? (
					<span className="badge bg-green-lt text-wrap text-start">
						<T
							id="settings.backup.schedule.next"
							data={{ when: formatTime(schedule.nextRunAt, timeZone) }}
						/>
					</span>
				) : null}
			</div>
			{error}
		</>
	);
}

function LastRun({ schedule, timeZone }) {
	if (!schedule.lastRunAt) {
		return (
			<span className="text-secondary">
				<T id="settings.backup.schedule.never" />
			</span>
		);
	}
	return (
		<>
			<div>
				<WrapBelowLg>{formatTime(schedule.lastRunAt, timeZone)}</WrapBelowLg>
			</div>
			{lastRunSize(schedule) ? (
				<div className="small text-secondary">{formatBytes(lastRunSize(schedule))}</div>
			) : null}
			{schedule.lastStatus === "failed" && schedule.lastError ? (
				<div className="small text-danger text-break">{schedule.lastError}</div>
			) : null}
		</>
	);
}

function Actions({ schedule, running, onRun, onEdit, onToggle, onDelete }) {
	if (running) {
		return (
			<span
				className="spinner-border spinner-border-sm"
				role="status"
				aria-label={label("settings.backup.schedule.running")}
			/>
		);
	}
	return (
		<span className="dropdown">
			<button
				type="button"
				className="btn dropdown-toggle btn-action btn-sm px-1 d-inline-block"
				aria-label={label("actions")}
				data-bs-boundary="viewport"
				data-bs-toggle="dropdown"
				data-bs-popper-config='{"strategy":"fixed"}'
			>
				<IconDotsVertical aria-hidden="true" />
			</button>
			<div className="dropdown-menu dropdown-menu-end">
				<span className="dropdown-header text-break">{schedule.name}</span>
				<button type="button" className="dropdown-item" onClick={() => onRun(schedule)}>
					<IconPlayerPlay className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="settings.backup.schedule.run-now" />
				</button>
				<button type="button" className="dropdown-item" onClick={() => onEdit(schedule)}>
					<IconEdit className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="action.edit" />
				</button>
				<button type="button" className="dropdown-item" onClick={() => onToggle(schedule)}>
					{schedule.enabled ? (
						<>
							<IconPlayerPause className="icon dropdown-item-icon" aria-hidden="true" />
							<T id="settings.backup.schedule.pause" />
						</>
					) : (
						<>
							<IconPlayerPlay className="icon dropdown-item-icon" aria-hidden="true" />
							<T id="settings.backup.schedule.resume" />
						</>
					)}
				</button>
				<div className="dropdown-divider" />
				<button type="button" className="dropdown-item text-danger" onClick={() => onDelete(schedule)}>
					<IconTrash className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="action.delete" />
				</button>
			</div>
		</span>
	);
}

function Table({ data, categories, timeZone, running, addButton, onRun, onEdit, onToggle, onDelete }) {
	const columns = useMemo(() => {
		const columnHelper = createColumnHelper();
		return [
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: label("column.name"),
				cell: (info) => <span className="text-break">{info.getValue()}</span>,
			}),
			columnHelper.display({
				id: "status",
				meta: { mobile: "title-below" },
				header: label("column.status"),
				cell: (info) => <StatusBadge schedule={info.row.original} timeZone={timeZone} />,
			}),
			columnHelper.accessor((row) => timingText(row, intl), {
				id: "timing",
				enableSorting: false,
				meta: { mobile: "summary", summaryText: (row) => timingText(row, intl) },
				header: label("settings.backup.schedule.column.timing"),
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor((row) => row.types ?? [], {
				id: "contents",
				enableSorting: false,
				meta: { mobile: "summary", summaryText: (row) => contentsText(categories, row.types) },
				header: label("settings.backup.contents"),
				cell: (info) => <Contents categories={categories} types={info.getValue()} />,
			}),
			columnHelper.accessor((row) => label(`settings.backup.schedule.protection.${row.protection}`), {
				id: "protection",
				meta: {
					mobile: "summary",
					summaryText: (row) => label(`settings.backup.schedule.protection.${row.protection}`),
				},
				header: label("settings.backup.schedule.column.protection"),
				cell: (info) => <WrapBelowLg>{info.getValue()}</WrapBelowLg>,
			}),
			columnHelper.accessor((row) => row.keep, {
				id: "keep",
				meta: {
					mobile: "summary",
					summaryText: (row) => label("settings.backup.schedule.keep-count", { count: row.keep }),
				},
				header: label("settings.backup.schedule.column.keep"),
				cell: (info) => info.getValue(),
			}),
			columnHelper.accessor((row) => row.lastRunAt ?? "", {
				id: "lastRun",
				meta: { mobile: "summary", summaryText: (row) => lastRunText(row, timeZone) },
				header: label("settings.backup.schedule.column.last-run"),
				cell: (info) => <LastRun schedule={info.row.original} timeZone={timeZone} />,
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => (
					<Actions
						schedule={info.row.original}
						running={running.includes(info.row.original.id)}
						onRun={onRun}
						onEdit={onEdit}
						onToggle={onToggle}
						onDelete={onDelete}
					/>
				),
				meta: { className: "text-end text-nowrap", mobile: "title-end" },
			}),
		];
	}, [categories, timeZone, running, onRun, onEdit, onToggle, onDelete]);

	const tableInstance = useTable({
		features,
		columns,
		data,
		getRowId: (row) => String(row.id),
		enableSortingRemoval: false,
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					icon={IconCalendarTime}
					object="backup-schedule"
					objects="backup-schedules"
					tableInstance={tableInstance}
					customAddBtn={addButton}
					permissionSection={ADMIN}
					permission={VIEW}
				/>
			}
		/>
	);
}

/**
 * The checkbox of the delete window: also delete the schedule's stored files. Unticked; shown only when it has files.
 *
 * @param {Object} props
 * @param {?number} props.count    the schedule's stored files (null when the folder could not be listed)
 * @param {Object} props.filesRef  { current: boolean }, set while ticked
 */
function DeleteFiles({ count, filesRef }) {
	const id = useId();
	const [checked, setChecked] = useState(false);
	if (!(count > 0)) return null;
	return (
		<label className="form-check d-inline-block text-start mb-0" htmlFor={id}>
			<input
				id={id}
				type="checkbox"
				className="form-check-input"
				checked={checked}
				onChange={(event) => {
					filesRef.current = event.target.checked;
					setChecked(event.target.checked);
				}}
			/>
			<span className="form-check-label">
				<T id="settings.backup.schedule.delete-files" data={{ count }} />
			</span>
		</label>
	);
}

/**
 * The backup schedules with their status, timing, contents, protection and retention, and Run now, Edit,
 * Pause/Resume and Delete per schedule. A run answers when the backup is finished; the row shows a spinner until
 * then. Times are shown in the server's zone, as the schedules run in it.
 */
function SchedulesCard() {
	const { data, isPending, error } = useBackupSchedules();
	const { data: types } = useBackupTypes();
	const run = useRunBackupSchedule();
	const save = useSaveBackupSchedule();
	// the ids of the schedules whose Run now is pending
	const [running, setRunning] = useState([]);
	const timeZone = types?.timeZone;

	const handlers = useMemo(
		() => ({
			onRun: async (schedule) => {
				setRunning((ids) => [...ids, schedule.id]);
				try {
					const result = await run.mutateAsync(schedule.id);
					// a failed backup still answers with the schedule, its error in lastError
					if (result?.lastStatus === "failed") {
						showError(result.lastError || label("settings.backup.schedule.failed"));
					} else {
						showSuccess(label("settings.backup.schedule.run-done"));
					}
				} catch (err) {
					showApiError(err);
				} finally {
					setRunning((ids) => ids.filter((id) => id !== schedule.id));
				}
			},
			onEdit: (schedule) => showBackupScheduleModal(schedule),
			onToggle: async (schedule) => {
				try {
					await save.mutateAsync({ id: schedule.id, enabled: !schedule.enabled });
					showObjectSuccess("backup-schedule", schedule.enabled ? "disabled" : "enabled");
				} catch (err) {
					showApiError(err);
				}
			},
			onDelete: (schedule) => {
				// whether to delete the schedule's files too; a new one for each window
				const filesRef = { current: false };
				showDeleteConfirmModal({
					title: <T id="object.delete" tData={{ object: "backup-schedule" }} />,
					subject: schedule.name,
					details: <DeleteFiles count={schedule.fileCount} filesRef={filesRef} />,
					onConfirm: async () => {
						await deleteBackupSchedule(schedule.id, filesRef.current);
						showObjectSuccess("backup-schedule", "deleted");
					},
					invalidations: [["backup-schedules"], ["backups"], ["host-report"]],
				});
			},
		}),
		[run.mutateAsync, save.mutateAsync],
	);

	const addButton = (
		<Button size="sm" onClick={() => showBackupScheduleModal(null)}>
			<IconPlus className="icon" aria-hidden="true" />
			<T id="settings.backup.schedule.add" />
		</Button>
	);

	return (
		<div className="card mb-4">
			<div className="card-header flex-wrap gap-2">
				<h3 className="card-title text-nowrap">
					<T id="settings.backup.schedules" />
				</h3>
				<div className="card-actions">{data?.length ? addButton : null}</div>
			</div>
			{isPending ? <Loading noLogo /> : null}
			{error ? (
				<div className="card-body">
					<ErrorAlert error={error} className="mb-0" />
				</div>
			) : null}
			{data?.some((schedule) => schedule.fileCount === null) ? (
				<div className="card-body py-2 small text-danger">
					<T id="settings.backup.schedule.count-error" />
				</div>
			) : null}
			{data ? (
				<Table
					data={data}
					categories={types?.categories ?? []}
					timeZone={timeZone}
					running={running}
					addButton={addButton}
					{...handlers}
				/>
			) : null}
			{data?.length && timeZone ? (
				<div className="card-footer small text-secondary">
					<T id="settings.backup.schedule.zone" data={{ zone: timeZone }} />
				</div>
			) : null}
		</div>
	);
}

export { SchedulesCard };
