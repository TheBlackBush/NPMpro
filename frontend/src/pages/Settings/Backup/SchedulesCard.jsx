import { IconCalendarTime, IconDotsVertical, IconPlayerPause, IconPlayerPlay, IconTrash } from "@tabler/icons-react";
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
import { useMemo, useState } from "react";
import { deleteBackupSchedule } from "src/api/backend";
import { EmptyData, ErrorAlert, Loading } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { useBackupSchedules, useBackupTypes, useRunBackupSchedule, useSaveBackupSchedule } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showDeleteConfirmModal } from "src/modals";
import { scheduleStatus, timingText } from "src/modules/BackupSchedules";
import { contentLabels } from "src/modules/BackupTypes";
import { formatBytes } from "src/modules/Monitoring";
import { ADMIN, VIEW } from "src/modules/Permissions";
import { showApiError, showError, showObjectSuccess } from "src/notifications";

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

const lastRunText = (schedule) =>
	schedule.lastRunAt
		? [schedule.lastSize ? formatBytes(schedule.lastSize) : null, formatDateTime(schedule.lastRunAt)]
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

function StatusBadge({ schedule }) {
	const status = scheduleStatus(schedule);
	if (status === "paused") {
		return (
			<span className="badge bg-secondary-lt">
				<T id="settings.backup.schedule.paused" />
			</span>
		);
	}
	if (status === "failed") {
		return (
			<span className="badge bg-red-lt text-wrap text-start" title={schedule.lastError ?? undefined}>
				<T id="settings.backup.schedule.failed" />
			</span>
		);
	}
	return schedule.nextRunAt ? (
		<span className="badge bg-green-lt text-wrap text-start">
			<T id="settings.backup.schedule.next" data={{ when: formatDateTime(schedule.nextRunAt) }} />
		</span>
	) : null;
}

function LastRun({ schedule }) {
	if (!schedule.lastRunAt) {
		return (
			<span className="text-secondary">
				<T id="settings.backup.schedule.never" />
			</span>
		);
	}
	return (
		<>
			<div className="text-nowrap">{formatDateTime(schedule.lastRunAt)}</div>
			{schedule.lastSize ? <div className="small text-secondary">{formatBytes(schedule.lastSize)}</div> : null}
		</>
	);
}

function Actions({ schedule, running, onRun, onToggle, onDelete }) {
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

function Table({ data, categories, running, onRun, onToggle, onDelete }) {
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
				cell: (info) => <StatusBadge schedule={info.row.original} />,
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
				cell: (info) => <span className="text-nowrap">{info.getValue()}</span>,
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
				meta: { mobile: "summary", summaryText: lastRunText },
				header: label("settings.backup.schedule.column.last-run"),
				cell: (info) => <LastRun schedule={info.row.original} />,
			}),
			columnHelper.accessor((row) => row.nextRunAt ?? "", {
				id: "nextRun",
				meta: { mobile: "hide" },
				header: label("settings.backup.schedule.column.next-run"),
				cell: (info) =>
					info.getValue() ? (
						<span className="text-nowrap">{formatDateTime(info.getValue())}</span>
					) : (
						<span className="text-secondary">-</span>
					),
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => (
					<Actions
						schedule={info.row.original}
						running={running.includes(info.row.original.id)}
						onRun={onRun}
						onToggle={onToggle}
						onDelete={onDelete}
					/>
				),
				meta: { className: "text-end text-nowrap", mobile: "title-end" },
			}),
		];
	}, [categories, running, onRun, onToggle, onDelete]);

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
					customAddBtn={false}
					permissionSection={ADMIN}
					permission={VIEW}
				/>
			}
		/>
	);
}

/**
 * The backup schedules with their status, timing, contents, protection and retention, and Run now, Pause/Resume and
 * Delete per schedule. A run answers when the backup is finished; the row shows a spinner until then.
 */
function SchedulesCard() {
	const { data, isPending, error } = useBackupSchedules();
	const { data: types } = useBackupTypes();
	const run = useRunBackupSchedule();
	const save = useSaveBackupSchedule();
	// the ids of the schedules whose Run now is pending
	const [running, setRunning] = useState([]);

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
						showObjectSuccess("backup-schedule", "saved");
					}
				} catch (err) {
					showApiError(err);
				} finally {
					setRunning((ids) => ids.filter((id) => id !== schedule.id));
				}
			},
			onToggle: async (schedule) => {
				try {
					await save.mutateAsync({ id: schedule.id, enabled: !schedule.enabled });
					showObjectSuccess("backup-schedule", schedule.enabled ? "disabled" : "enabled");
				} catch (err) {
					showApiError(err);
				}
			},
			onDelete: (schedule) =>
				showDeleteConfirmModal({
					title: <T id="object.delete" tData={{ object: "backup-schedule" }} />,
					subject: schedule.name,
					onConfirm: async () => {
						await deleteBackupSchedule(schedule.id, false);
						showObjectSuccess("backup-schedule", "deleted");
					},
					invalidations: [["backup-schedules"], ["backups"], ["host-report"]],
				}),
		}),
		[run.mutateAsync, save.mutateAsync],
	);

	return (
		<div className="card mb-4">
			<div className="card-header flex-wrap gap-2">
				<h3 className="card-title text-nowrap">
					<T id="settings.backup.schedules" />
				</h3>
				<div className="card-actions" />
			</div>
			{isPending ? <Loading noLogo /> : null}
			{error ? (
				<div className="card-body">
					<ErrorAlert error={error} className="mb-0" />
				</div>
			) : null}
			{data ? <Table data={data} categories={types?.categories ?? []} running={running} {...handlers} /> : null}
		</div>
	);
}

export { SchedulesCard };
