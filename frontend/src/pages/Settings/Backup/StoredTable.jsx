import { IconArchive, IconDotsVertical, IconDownload, IconRestore, IconTrash, IconUpload } from "@tabler/icons-react";
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
import cn from "clsx";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { deleteBackup, downloadBackup } from "src/api/backend";
import { Button, EmptyData, ErrorAlert, Loading } from "src/components";
import { TableLayout } from "src/components/Table/TableLayout";
import { TablePagination } from "src/components/Table/TablePagination";
import { useBackupSchedules, useBackups, useBackupTypes, useUploadBackup } from "src/hooks";
import { formatDateTime, intl, T } from "src/locale";
import { showDeleteConfirmModal, showRestoreBackupModal } from "src/modals";
import { filterBySchedule, scheduleBadge, scheduleNames } from "src/modules/BackupSchedules";
import { contentLabels, withErrorDetails } from "src/modules/BackupTypes";
import { formatBytes } from "src/modules/Monitoring";
import { ADMIN, VIEW } from "src/modules/Permissions";
import { showApiError, showObjectSuccess } from "src/notifications";

const label = (id) => intl.formatMessage({ id });

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
		<div className="badge-list">
			{contentLabels(categories, types).map(({ kind, id }) => (
				<span key={`${kind}-${id}`} className="badge bg-secondary-lt text-wrap text-start">
					<T id={kind === "category" ? `settings.backup.category.${id}` : `settings.backup.type.${id}`} />
				</span>
			))}
		</div>
	);
}

// below lg the content may wrap, so the table fits next to the settings menu on tablets; from lg it stays on one line
function WrapBelowLg({ children }) {
	return (
		<>
			<span className="d-lg-none">{children}</span>
			<span className="d-none d-lg-inline text-nowrap">{children}</span>
		</>
	);
}

function SecretsBadge({ entry }) {
	const secrets = entry.summary?.secrets;
	return (
		<span className={cn("badge text-wrap text-start", secrets ? "bg-azure-lt" : "bg-secondary-lt")}>
			<WrapBelowLg>
				<T id={secrets ? "settings.backup.with-secrets" : "settings.backup.without-secrets"} />
			</WrapBelowLg>
		</span>
	);
}

// the schedule that made a file; "Deleted schedule" for a file left from one that no longer exists; nothing until
// the schedule list is loaded
function ScheduleBadge({ entry, names }) {
	const badge = scheduleBadge(entry, names);
	if (!badge) return null;
	return (
		<div className="mt-1">
			<span className="badge bg-indigo-lt text-wrap text-start">
				{badge.kind === "name" ? badge.name : <T id="settings.backup.schedule.deleted" />}
			</span>
		</div>
	);
}

function NameCell({ entry, names }) {
	return (
		<>
			<div className="text-break">{entry.name}</div>
			<ScheduleBadge entry={entry} names={names} />
			{entry.auto ? (
				<div className="mt-1">
					<span className="badge bg-purple-lt me-2">
						<T id="settings.backup.automatic" />
					</span>
					<span className="small text-secondary">
						<T id="settings.backup.automatic.hint" />
					</span>
				</div>
			) : null}
			{entry.summary ? null : (
				<div className="mt-1">
					<span className="badge bg-warning-lt">
						<T id="settings.backup.unreadable" />
					</span>
				</div>
			)}
		</>
	);
}

function Actions({ entry, onDelete, navigate }) {
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
				<span className="dropdown-header text-break">{entry.name}</span>
				<button
					type="button"
					className="dropdown-item"
					onClick={() => downloadBackup(entry.name).catch((err) => showApiError(err))}
				>
					<IconDownload className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="action.download" />
				</button>
				<button
					type="button"
					className="dropdown-item"
					disabled={!entry.summary}
					title={entry.summary ? undefined : label("settings.backup.unreadable")}
					onClick={() => showRestoreBackupModal(entry, navigate)}
				>
					<IconRestore className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="settings.backup.restore" />
				</button>
				<div className="dropdown-divider" />
				<button type="button" className="dropdown-item text-danger" onClick={() => onDelete(entry)}>
					<IconTrash className="icon dropdown-item-icon" aria-hidden="true" />
					<T id="action.delete" />
				</button>
			</div>
		</span>
	);
}

function Table({ data, categories, names, filtered, onClearFilter, onDelete, navigate, uploadButton }) {
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
					summaryText: (row) => formatDateTime(row.summary?.createdAt ?? row.modified),
				},
				header: label("settings.backup.created"),
				cell: (info) => <WrapBelowLg>{formatDateTime(info.getValue())}</WrapBelowLg>,
			}),
			columnHelper.accessor((row) => row.size, {
				id: "size",
				meta: { mobile: "summary", summaryText: (row) => formatBytes(row.size) },
				header: label("settings.backup.size"),
				cell: (info) => <span className="text-nowrap">{formatBytes(info.getValue())}</span>,
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
				cell: (info) => <Actions entry={info.row.original} onDelete={onDelete} navigate={navigate} />,
				meta: { className: "text-end text-nowrap", mobile: "title-end" },
			}),
		];
	}, [categories, names, onDelete, navigate]);

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
	});

	return (
		<>
			<TableLayout
				tableInstance={tableInstance}
				emptyState={
					<EmptyData
						icon={IconArchive}
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

	const onDelete = useMemo(
		() => (entry) =>
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
		[],
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
			<IconUpload className="icon" aria-hidden="true" />
			<T id="settings.backup.upload" />
		</Button>
	);

	return (
		<div className="card">
			<div className="card-header flex-wrap gap-2">
				<h3 className="card-title text-nowrap">
					<T id="settings.backup.stored" />
				</h3>
				<div className="card-actions d-flex flex-wrap align-items-center gap-2">
					{scheduled.length > 0 ? (
						<select
							className="form-select form-select-sm w-auto"
							value={activeFilter}
							onChange={(event) => setFilter(event.target.value)}
							aria-label={label("settings.backup.schedule.filter")}
						>
							<option value="">{label("settings.backup.schedule.filter.all")}</option>
							<option value="none">{label("settings.backup.schedule.filter.none")}</option>
							{filterOptions.map(([id, name]) => (
								<option key={id} value={String(id)}>
									{name}
								</option>
							))}
						</select>
					) : null}
					<input
						ref={inputRef}
						type="file"
						accept=".npmpro"
						className="d-none"
						aria-label={label("settings.backup.upload")}
						onChange={onFile}
					/>
					{data?.length ? uploadButton : null}
				</div>
			</div>
			{uploading ? (
				<div className="card-body border-bottom">
					<div className="d-flex align-items-center mb-2">
						<span className="text-secondary" role="status">
							<T id="settings.backup.uploading" data={{ percent }} />
						</span>
						<Button size="sm" className="ms-auto" onClick={() => abortRef.current?.abort()}>
							<T id="cancel" />
						</Button>
					</div>
					<div className="progress progress-sm">
						<div
							className="progress-bar"
							style={{ width: `${percent}%` }}
							role="progressbar"
							aria-valuenow={percent}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-label={label("settings.backup.upload")}
						/>
					</div>
				</div>
			) : null}
			{uploadError ? (
				<div className="card-body border-bottom">
					<ErrorAlert error={uploadError} onClose={() => setUploadError(null)} className="mb-0" />
				</div>
			) : null}
			{isPending ? <Loading noLogo /> : null}
			{error ? (
				<div className="card-body">
					<ErrorAlert error={error} className="mb-0" />
				</div>
			) : null}
			{data ? (
				<Table
					data={shown}
					categories={types?.categories ?? []}
					names={names}
					filtered={activeFilter}
					onClearFilter={() => setFilter("")}
					onDelete={onDelete}
					navigate={navigate}
					uploadButton={uploadButton}
				/>
			) : null}
		</div>
	);
}

export { StoredTable };
