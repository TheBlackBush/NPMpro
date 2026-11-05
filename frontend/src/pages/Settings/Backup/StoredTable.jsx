import {
	createColumnHelper,
	createPaginatedRowModel,
	createSortedRowModel,
	rowPaginationFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";
import { Archive, Bot, CalendarClock, Download, KeyRound, RotateCcw, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { deleteBackup, downloadBackup } from "src/api/backend";
import { Button, EmptyData, ErrorAlert, Loading, RowActions } from "src/components";
import { AppSelect } from "src/components/AppSelect";
import { StatusBadge } from "src/components/StatusBadge";
import { TableLayout } from "src/components/Table/TableLayout";
import { TablePagination } from "src/components/Table/TablePagination";
import { Badge } from "src/components/ui/badge";
import { Progress } from "src/components/ui/progress";
import { useBackupSchedules, useBackups, useBackupTypes, useUploadBackup } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showDeleteConfirmModal, showRestoreBackupModal } from "src/modals";
import { filterBySchedule, formatInZone, scheduleBadge, scheduleNames } from "src/modules/BackupSchedules";
import { contentLabels, withErrorDetails } from "src/modules/BackupTypes";
import { WRAP_BADGE } from "src/modules/Badges";
import { formatBytes } from "src/modules/Monitoring";
import { ADMIN, VIEW } from "src/modules/Permissions";
import { showApiError, showObjectSuccess } from "src/notifications";
import { SettingsCard } from "../SettingsCard";
import { WrapBelowLg } from "./WrapBelowLg";

const label = (id) => intl.formatMessage({ id });

// in the server's zone like the schedules card; the browser's until the zone is known
const createdText = (value, timeZone) =>
	timeZone ? formatInZone(value, intl.locale, timeZone) : formatDateTime(value);

const PAGE_SIZE = 10;

const features = tableFeatures({
	rowSortingFeature,
	rowPaginationFeature,
	sortedRowModel: createSortedRowModel(),
	paginatedRowModel: createPaginatedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric, datetime: sortFn_datetime, text: sortFn_text },
});

function Contents({ categories, types }) {
	return (
		<div className="flex flex-wrap gap-1">
			{contentLabels(categories, types).map(({ kind, id }) => (
				<Badge key={`${kind}-${id}`} variant="secondary" className={WRAP_BADGE}>
					<T id={kind === "category" ? `settings.backup.category.${id}` : `settings.backup.type.${id}`} />
				</Badge>
			))}
		</div>
	);
}

function SecretsBadge({ entry }) {
	const secrets = entry.summary?.secrets;
	return (
		<Badge variant={secrets ? "outline" : "secondary"} className={WRAP_BADGE}>
			{secrets ? <KeyRound className="size-3" aria-hidden="true" /> : null}
			<WrapBelowLg>
				<T id={secrets ? "settings.backup.with-secrets" : "settings.backup.without-secrets"} />
			</WrapBelowLg>
		</Badge>
	);
}

// the schedule that made a file; "Deleted schedule" for a file left from one that no longer exists; nothing until
// the schedule list is loaded
function ScheduleBadge({ entry, names }) {
	const badge = scheduleBadge(entry, names);
	if (!badge) return null;
	return (
		<div className="mt-1">
			<Badge variant="outline" className={WRAP_BADGE}>
				<CalendarClock className="size-3" aria-hidden="true" />
				<span className="min-w-0 wrap-anywhere">
					{badge.kind === "name" ? badge.name : <T id="settings.backup.schedule.deleted" />}
				</span>
			</Badge>
		</div>
	);
}

function NameCell({ entry, names }) {
	return (
		<>
			<div className="wrap-anywhere">{entry.name}</div>
			<ScheduleBadge entry={entry} names={names} />
			{entry.auto ? (
				<div className="mt-1 flex flex-wrap items-center gap-2">
					<Badge variant="outline">
						<Bot className="size-3" aria-hidden="true" />
						<T id="settings.backup.automatic" />
					</Badge>
					<span className="text-sm text-muted-foreground">
						<T id="settings.backup.automatic.hint" />
					</span>
				</div>
			) : null}
			{entry.summary ? null : (
				<div className="mt-1">
					<StatusBadge tone="warning" dot={false}>
						<T id="settings.backup.unreadable" />
					</StatusBadge>
				</div>
			)}
		</>
	);
}

function Actions({ entry, onDelete, navigate }) {
	return (
		<RowActions
			label={intl.formatMessage({ id: "list.row-actions" }, { name: entry.name })}
			focusKey={`backup-file-${entry.name}`}
			title={entry.name}
			items={[
				{
					key: "download",
					label: <T id="action.download" />,
					icon: Download,
					onSelect: () => downloadBackup(entry.name).catch((err) => showApiError(err)),
				},
				{
					key: "restore",
					label: <T id="settings.backup.restore" />,
					icon: RotateCcw,
					// an unreadable file cannot be restored (the row says why with its "Unreadable" badge)
					disabled: !entry.summary,
					onSelect: () => showRestoreBackupModal(entry, navigate),
				},
				{
					key: "delete",
					label: <T id="action.delete" />,
					icon: Trash2,
					destructive: true,
					separatorBefore: true,
					onSelect: () => onDelete(entry),
				},
			]}
		/>
	);
}

function Table({ data, categories, timeZone, names, filtered, onClearFilter, actions, uploadButton }) {
	const columns = useMemo(() => {
		const columnHelper = createColumnHelper();
		return [
			columnHelper.accessor((row) => row.name, {
				id: "name",
				meta: { mobile: "title" },
				header: label("column.name"),
				cell: (info) => <NameCell entry={info.row.original} names={names} />,
			}),
			columnHelper.accessor((row) => row.summary?.createdAt ?? row.modified, {
				id: "created",
				meta: {
					mobile: "summary",
					summaryText: (row) => createdText(row.summary?.createdAt ?? row.modified, timeZone),
				},
				header: label("settings.backup.created"),
				cell: (info) => <WrapBelowLg>{createdText(info.getValue(), timeZone)}</WrapBelowLg>,
			}),
			columnHelper.accessor((row) => row.size, {
				id: "size",
				meta: { mobile: "summary", summaryText: (row) => formatBytes(row.size) },
				header: label("settings.backup.size"),
				cell: (info) => <span className="whitespace-nowrap">{formatBytes(info.getValue())}</span>,
			}),
			columnHelper.accessor((row) => row.summary?.types ?? [], {
				id: "contents",
				header: label("settings.backup.contents"),
				enableSorting: false,
				meta: {
					mobile: "summary",
					summaryText: (row) =>
						contentLabels(categories, row.summary?.types ?? [])
							.map(({ kind, id }) =>
								label(
									kind === "category"
										? `settings.backup.category.${id}`
										: `settings.backup.type.${id}`,
								),
							)
							.join(", "),
				},
				cell: (info) => <Contents categories={categories} types={info.getValue()} />,
			}),
			columnHelper.display({
				id: "secrets",
				meta: { mobile: "title-below" },
				header: label("settings.backup.secrets.column"),
				cell: (info) => (info.row.original.summary ? <SecretsBadge entry={info.row.original} /> : null),
			}),
			columnHelper.display({
				id: "actions",
				cell: (info) => <Actions entry={info.row.original} {...info.table.options.meta?.actions} />,
				meta: { className: "text-right whitespace-nowrap", mobile: "title-end" },
			}),
		];
	}, [categories, timeZone, names]);

	// 10 backups per page; a changed list (upload, new backup, delete) goes back to the first page
	const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: PAGE_SIZE });
	// another schedule filter starts on the first page
	const [shownFilter, setShownFilter] = useState(filtered);
	if (shownFilter !== filtered) {
		setShownFilter(filtered);
		setPagination((current) => ({ ...current, pageIndex: 0 }));
	}
	const tableInstance = useTable({
		features,
		columns,
		data,
		getRowId: (row) => row.name,
		enableSortingRemoval: false,
		state: { pagination },
		onPaginationChange: setPagination,
		// the row handlers reach the cells here, so the columns keep their identity
		meta: { actions },
	});

	return (
		<>
			<TableLayout
				stackBy="container"
				tableInstance={tableInstance}
				emptyState={
					<EmptyData
						icon={Archive}
						object="backup"
						objects="backups"
						tableInstance={tableInstance}
						isFiltered={filtered !== ""}
						onClearFilters={onClearFilter}
						customAddBtn={uploadButton}
						permissionSection={ADMIN}
						permission={VIEW}
					/>
				}
			/>
			<TablePagination
				pageIndex={pagination.pageIndex}
				pageSize={pagination.pageSize}
				total={data.length}
				onPage={(pageIndex) => setPagination((current) => ({ ...current, pageIndex }))}
			/>
		</>
	);
}

/**
 * The backups stored on the server (made here, uploaded, or made automatically before a restore) with download,
 * restore and delete, and the upload of a backup file. An uploaded file opens the restore at once.
 */
function StoredTable() {
	const { data, isPending, error } = useBackups();
	const { data: types } = useBackupTypes();
	const { data: schedules } = useBackupSchedules();
	const upload = useUploadBackup();
	const navigate = useNavigate();
	const inputRef = useRef(null);
	const abortRef = useRef(null);
	const [progress, setProgress] = useState(null);
	const [uploadError, setUploadError] = useState(null);

	const onFile = async (event) => {
		const [file] = event.target.files ?? [];
		// the same file can be chosen again after a failed upload
		event.target.value = "";
		if (!file) return;
		setUploadError(null);
		setProgress(0);
		abortRef.current = new AbortController();
		try {
			const { entry } = await upload.mutateAsync({
				file,
				onProgress: setProgress,
				abortController: abortRef.current,
			});
			showRestoreBackupModal(entry, navigate);
		} catch (err) {
			if (err?.name !== "AbortError") setUploadError(withErrorDetails(err));
		} finally {
			abortRef.current = null;
			setProgress(null);
		}
	};

	const actions = useMemo(
		() => ({
			navigate,
			onDelete: (entry) =>
				showDeleteConfirmModal({
					title: <T id="object.delete" tData={{ object: "backup" }} />,
					onConfirm: async () => {
						await deleteBackup(entry.name);
						showObjectSuccess("backup", "deleted");
					},
					invalidations: [["backups"]],
					children: <T id="settings.backup.delete.content" />,
					subject: entry.name,
				}),
		}),
		[navigate],
	);

	// the "Schedule" filter: "" all, "none" not scheduled, else a schedule id
	const [filter, setFilter] = useState("");
	// null while the schedule list is not loaded (or failed): the badges wait for it
	const names = useMemo(() => (schedules ? scheduleNames(schedules) : null), [schedules]);
	const scheduled = useMemo(
		() => (data ?? []).filter((entry) => entry.scheduleId !== null && entry.scheduleId !== undefined),
		[data],
	);
	// the schedules that have files, by name
	const filterOptions = useMemo(
		() =>
			[...(names ?? [])]
				.filter(([id]) => scheduled.some((entry) => entry.scheduleId === id))
				.sort(([, a], [, b]) => a.localeCompare(b, intl.locale)),
		[names, scheduled],
	);
	// back to All once no file is scheduled or the chosen schedule is no longer offered
	const offered = filter === "" || filter === "none" || filterOptions.some(([id]) => String(id) === filter);
	const activeFilter = scheduled.length > 0 && offered ? filter : "";
	if (activeFilter !== filter) setFilter(activeFilter);
	const shown = useMemo(() => (data ? filterBySchedule(data, activeFilter) : data), [data, activeFilter]);

	const uploading = progress !== null;
	const percent = Math.round((progress ?? 0) * 100);
	const uploadButton = (
		<Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
			<Upload aria-hidden="true" />
			<T id="settings.backup.upload" />
		</Button>
	);

	return (
		<SettingsCard
			title={<T id="settings.backup.stored" />}
			bodyClassName="space-y-0 p-0"
			actions={
				<>
					{scheduled.length > 0 ? (
						<AppSelect
							size="sm"
							className="max-w-full sm:w-56"
							value={activeFilter}
							onValueChange={setFilter}
							aria-label={label("settings.backup.schedule.filter")}
							options={[
								{ value: "", label: label("settings.backup.schedule.filter.all") },
								{ value: "none", label: label("settings.backup.schedule.filter.none") },
								...filterOptions.map(([id, name]) => ({ value: String(id), label: name })),
							]}
						/>
					) : null}
					<input
						ref={inputRef}
						type="file"
						accept=".npmpro"
						className="hidden"
						aria-label={label("settings.backup.upload")}
						onChange={onFile}
					/>
					{data?.length ? uploadButton : null}
				</>
			}
		>
			{uploading ? (
				<div className="space-y-2 border-b p-4">
					<div className="flex items-center gap-2">
						<span className="text-muted-foreground" role="status">
							<T id="settings.backup.uploading" data={{ percent }} />
						</span>
						<Button size="sm" variant="ghost" className="ms-auto" onClick={() => abortRef.current?.abort()}>
							<T id="cancel" />
						</Button>
					</div>
					<Progress value={percent} aria-label={label("settings.backup.upload")} />
				</div>
			) : null}
			{uploadError ? (
				<div className="border-b p-4">
					<ErrorAlert error={uploadError} onClose={() => setUploadError(null)} className="mb-0" />
				</div>
			) : null}
			{isPending ? <Loading noLogo /> : null}
			{error ? (
				<div className="p-4">
					<ErrorAlert error={error} className="mb-0" />
				</div>
			) : null}
			{data ? (
				<Table
					data={shown}
					categories={types?.categories ?? []}
					timeZone={types?.timeZone}
					names={names}
					filtered={activeFilter}
					onClearFilter={() => setFilter("")}
					actions={actions}
					uploadButton={uploadButton}
				/>
			) : null}
		</SettingsCard>
	);
}

export { StoredTable };
