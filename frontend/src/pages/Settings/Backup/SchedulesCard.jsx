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
import { CalendarClock, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { deleteBackupSchedule } from "src/api/backend";
import { Button, EmptyData, ErrorAlert, Loading, RowActions } from "src/components";
import { StatusBadge } from "src/components/StatusBadge";
import { TableLayout } from "src/components/Table/TableLayout";
import { Badge } from "src/components/ui/badge";
import { Checkbox } from "src/components/ui/checkbox";
import { Spinner } from "src/components/ui/spinner";
import { useBackupSchedules, useBackupTypes, useRunBackupSchedule, useSaveBackupSchedule } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { showBackupScheduleModal, showDeleteConfirmModal } from "src/modals";
import { formatInZone, lastRunSize, scheduleStatus, timingText } from "src/modules/BackupSchedules";
import { contentLabels } from "src/modules/BackupTypes";
import { WRAP_BADGE } from "src/modules/Badges";
import { formatBytes } from "src/modules/Monitoring";
import { ADMIN, VIEW } from "src/modules/Permissions";
import { showApiError, showError, showObjectSuccess, showSuccess } from "src/notifications";
import { SettingsCard } from "../SettingsCard";

const label = (id, values) => intl.formatMessage({ id }, values);

// a word longer than this cannot sit in the narrow Name column, so such a name may break inside its words
const LONG_WORD = 12;

// a name wraps between its words; only a name with a very long word may break inside it
const nameClass = (name) =>
	String(name)
		.split(/\s+/u)
		.some((word) => [...word].length > LONG_WORD)
		? "wrap-anywhere"
		: undefined;

const keepText = (row) => label("settings.backup.schedule.keep-count", { count: row.keep });

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
		<div className="flex flex-wrap gap-1">
			{contentLabels(categories, types ?? []).map((item) => (
				<Badge key={`${item.kind}-${item.id}`} variant="secondary" className={WRAP_BADGE}>
					<T id={contentLabelId(item)} />
				</Badge>
			))}
		</div>
	);
}

function ScheduleStatus({ schedule, timeZone }) {
	const status = scheduleStatus(schedule);
	// the error of a failed last run (paused too): on phones under the badges, on wider screens in the Last run column
	const error =
		schedule.lastStatus === "failed" && schedule.lastError ? (
			<div className="mt-1 text-sm text-destructive wrap-anywhere md:hidden">{schedule.lastError}</div>
		) : null;
	if (status === "paused") {
		return (
			<>
				<Badge variant="secondary" className={WRAP_BADGE}>
					<T id="settings.backup.schedule.paused" />
				</Badge>
				{error}
			</>
		);
	}
	// a failed schedule still runs again: "Failed" and its next run
	return (
		<>
			<div className="flex flex-wrap gap-1">
				{status === "failed" ? (
					<StatusBadge
						tone="destructive"
						dot={false}
						className={WRAP_BADGE}
						title={schedule.lastError ?? undefined}
					>
						<T id="settings.backup.schedule.failed" />
					</StatusBadge>
				) : null}
				{schedule.nextRunAt ? (
					<StatusBadge tone="success" dot={false} className={cn(WRAP_BADGE, "md:whitespace-nowrap")}>
						<T
							id="settings.backup.schedule.next"
							data={{ when: formatTime(schedule.nextRunAt, timeZone) }}
						/>
					</StatusBadge>
				) : null}
			</div>
			{error}
		</>
	);
}

function LastRun({ schedule, timeZone }) {
	if (!schedule.lastRunAt) {
		return (
			<span className="text-muted-foreground">
				<T id="settings.backup.schedule.never" />
			</span>
		);
	}
	return (
		<>
			<div>{formatTime(schedule.lastRunAt, timeZone)}</div>
			{lastRunSize(schedule) ? (
				<div className="text-sm text-muted-foreground">{formatBytes(lastRunSize(schedule))}</div>
			) : null}
			{schedule.lastStatus === "failed" && schedule.lastError ? (
				<div className="text-sm text-destructive wrap-anywhere">{schedule.lastError}</div>
			) : null}
		</>
	);
}

function Actions({ schedule, running, onRun, onEdit, onToggle, onDelete }) {
	if (running) {
		return <Spinner role="status" aria-label={label("settings.backup.schedule.running")} />;
	}
	return (
		<RowActions
			label={intl.formatMessage({ id: "list.row-actions" }, { name: schedule.name })}
			focusKey={`backup-schedule-${schedule.id}`}
			title={schedule.name}
			items={[
				{
					key: "run",
					label: <T id="settings.backup.schedule.run-now" />,
					icon: Play,
					onSelect: () => onRun(schedule),
				},
				{ key: "edit", label: <T id="action.edit" />, icon: Pencil, onSelect: () => onEdit(schedule) },
				{
					key: "toggle",
					label: (
						<T
							id={schedule.enabled ? "settings.backup.schedule.pause" : "settings.backup.schedule.resume"}
						/>
					),
					icon: schedule.enabled ? Pause : Play,
					onSelect: () => onToggle(schedule),
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					destructive: true,
					separatorBefore: true,
					onSelect: () => onDelete(schedule),
				},
			]}
		/>
	);
}

function Table({ data, categories, timeZone, running, addButton, handlers }) {
	const columns = useMemo(() => {
		const columnHelper = createColumnHelper();
		return [
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: label("column.name"),
				cell: (info) => <span className={nameClass(info.getValue())}>{info.getValue()}</span>,
			}),
			columnHelper.display({
				id: "status",
				meta: { mobile: "title-below" },
				header: label("column.status"),
				cell: (info) => <ScheduleStatus schedule={info.row.original} timeZone={timeZone} />,
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
				// no sort button: the header stays narrow enough for the table to fit next to the settings menu
				enableSorting: false,
				// with the retention: below xl (the settings menu takes room from lg) the Keep column is hidden and its
				// count shows here
				meta: {
					mobile: "summary",
					summaryText: (row) =>
						`${label(`settings.backup.schedule.protection.${row.protection}`)} · ${keepText(row)}`,
				},
				header: label("settings.backup.schedule.column.protection"),
				cell: (info) => (
					<>
						{info.getValue()}
						<div className="text-sm text-muted-foreground xl:hidden">{keepText(info.row.original)}</div>
					</>
				),
			}),
			columnHelper.accessor((row) => row.keep, {
				id: "keep",
				// phones show the count in the Protection summary
				meta: { className: "hidden xl:table-cell" },
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
						running={info.table.options.meta?.running.includes(info.row.original.id)}
						{...info.table.options.meta?.handlers}
					/>
				),
				meta: { className: "text-right whitespace-nowrap", mobile: "title-end" },
			}),
		];
	}, [categories, timeZone]);

	const tableInstance = useTable({
		features,
		columns,
		data,
		getRowId: (row) => String(row.id),
		enableSortingRemoval: false,
		// the row handlers and the running ids reach the cells here, so the columns keep their identity
		meta: { running, handlers },
	});

	return (
		<TableLayout
			tableInstance={tableInstance}
			emptyState={
				<EmptyData
					icon={CalendarClock}
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
		<div className="flex items-start gap-2 text-left">
			<Checkbox
				id={id}
				className="mt-0.5"
				checked={checked}
				onCheckedChange={(value) => {
					filesRef.current = value === true;
					setChecked(value === true);
				}}
			/>
			<label htmlFor={id} className="text-sm">
				<T id="settings.backup.schedule.delete-files" data={{ count }} />
			</label>
		</div>
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
			<Plus aria-hidden="true" />
			<T id="settings.backup.schedule.add" />
		</Button>
	);

	return (
		<SettingsCard
			title={<T id="settings.backup.schedules" />}
			actions={data?.length ? addButton : null}
			bodyClassName="space-y-0 p-0"
			footer={
				data?.length && timeZone ? (
					<span className="mr-auto text-sm text-muted-foreground">
						<T id="settings.backup.schedule.zone" data={{ zone: timeZone }} />
					</span>
				) : null
			}
		>
			{isPending ? <Loading noLogo /> : null}
			{error ? (
				<div className="p-4">
					<ErrorAlert error={error} className="mb-0" />
				</div>
			) : null}
			{data?.some((schedule) => schedule.fileCount === null) ? (
				<div className="px-4 py-2 text-sm text-destructive">
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
					handlers={handlers}
				/>
			) : null}
		</SettingsCard>
	);
}

export { SchedulesCard };
