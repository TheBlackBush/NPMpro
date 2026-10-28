import { IconAlertCircle, IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { cancelRestore, checkRestore, inspectBackup, openImport } from "src/api/backend";
import { AppModal, Button, ErrorAlert, Loading, PasswordInput } from "src/components";
import { useBackupTypes, useImportUpload, useRestoreBackup } from "src/hooks";
import { useElapsed } from "src/hooks/useElapsed";
import { formatDateTime, intl, T } from "src/locale";
import { emptyItemType } from "src/modules/BackupMerge";
import { categoriesOf, PASSPHRASE_MIN_LENGTH, restoreBlockReason, withErrorDetails } from "src/modules/BackupTypes";
import { formatElapsed } from "src/modules/Duration";
import EasyModal from "src/modules/easyModal";
import { TypeTree } from "src/pages/Settings/Backup/TypeTree";
import { importCategories, isTooLarge, MAX_IMPORT, tooLargeError, Uploading } from "./RestoreBackup/ImportFile";
import { ItemList } from "./RestoreBackup/ItemList";
import { MergeNotes, MergeView, ModeSwitch, useMergePlan } from "./RestoreBackup/MergeView";

/**
 * @param {Object}   entry       a stored backup as listed by GET /api/backups
 * @param {Function} [navigate]  opens an app route (the modal is outside the router), for the host list links
 */
const showRestoreBackupModal = (entry, navigate) => {
	EasyModal.show(RestoreBackupModal, { entry, navigate });
};

/**
 * Import a file on a list page: the upload, the passphrase when the file has secrets, then the merge view limited to
 * the page's kind and the linked kinds the file holds.
 *
 * @param {string}   kind        the page's kind of items (proxy_hosts, certificates, ...)
 * @param {File}     file        the chosen .npmpro file
 * @param {Function} [navigate]  opens an app route, for the host list links of the result
 */
const showImportItemsModal = (kind, file, navigate) => {
	EasyModal.show(RestoreBackupModal, { importKind: kind, file, navigate });
};

// the host list of each host table, for hosts left offline after a restore
const HOST_LISTS = {
	proxy_host: { path: "/nginx/proxy", labelId: "proxy-hosts" },
	redirection_host: { path: "/nginx/redirection", labelId: "redirection-hosts" },
	dead_host: { path: "/nginx/404", labelId: "dead-hosts" },
	stream: { path: "/nginx/stream", labelId: "streams" },
};

// the merge wording of the restore reasons
const MERGE_REASONS = {
	"settings.backup.reason.checking": "settings.backup.reason.checking-changes",
	"settings.backup.reason.confirm": "settings.backup.reason.confirm-merge",
};
// reasons that come before an emptied item list
const EARLY_REASONS = [
	"settings.backup.reason.parts-loading",
	"settings.backup.reason.parts-failed",
	"settings.backup.reason.no-restore-types",
];

const typeLabel = (typeId) => intl.formatMessage({ id: `settings.backup.type.${typeId}` });

// a settings group by its name in the Environment section, the raw id when there is none
const groupLabel = (group) => {
	const id = `settings.environment.group.${group}`;
	return intl.messages[id] ? intl.formatMessage({ id }) : group;
};

const referenceItems = (references = []) =>
	references.map((ref, index) => ({ key: `${ref.table}-${ref.id}-${ref.column}-${index}`, text: ref.label }));

const userItems = (users = []) =>
	users.map((user) => ({ key: user.id, text: user.name ? `${user.name} (${user.email})` : user.email }));

const typeItems = (typeIds = []) => typeIds.map((typeId) => ({ key: typeId, text: typeLabel(typeId) }));

// what a restore of the current selection changes besides replacing it
function PreviewLists({ preview }) {
	return (
		<>
			<ItemList titleId="settings.backup.restore.references" items={referenceItems(preview.references)} />
			<ItemList titleId="settings.backup.restore.skipped-users" items={userItems(preview.skippedUsers)} />
			<ItemList titleId="settings.backup.restore.missing-secrets" items={typeItems(preview.missingSecrets)} />
		</>
	);
}

function Alert({ variant, icon: Icon, children }) {
	return (
		<div className={`alert alert-${variant}`} role={variant === "danger" ? "alert" : "status"}>
			<div className="alert-icon">
				<Icon className="icon" aria-hidden="true" />
			</div>
			<div className="text-break">{children}</div>
		</div>
	);
}

function Running() {
	const elapsed = useElapsed(true);
	return (
		<div className="py-3">
			<div className="text-secondary mb-2">
				<span role="status">
					<T id="settings.backup.restore.running" />
				</span>
				<span className="ms-1" aria-hidden="true">
					<T id="certificates.request.progress" data={{ elapsed: formatElapsed(elapsed) }} />
				</span>
			</div>
			<div className="progress progress-sm" role="progressbar" aria-label={intl.formatMessage({ id: "loading" })}>
				<div className="progress-bar progress-bar-indeterminate" />
			</div>
			<p className="text-secondary small mt-3 mb-0">
				<T id="settings.backup.restore.running.hint" />
			</p>
		</div>
	);
}

function Result({ result, types, plan, onOpen }) {
	const monitoring = types.includes("settings_monitoring");
	const merged = plan !== null;
	const counts = Object.entries(result.counts ?? {});
	return (
		<>
			<Alert variant="success" icon={IconCircleCheck}>
				<div className="fw-bold">
					<T id={merged ? "settings.backup.merge.done" : "settings.backup.restore.done"} />
				</div>
				{counts.length > 0 ? (
					<ul className="mb-0 mt-1">
						{counts.map(([typeId, count]) => (
							<li key={typeId}>
								<T id="settings.backup.restore.count" data={{ type: typeLabel(typeId), count }} />
							</li>
						))}
					</ul>
				) : null}
			</Alert>
			{result.restartNeeded || monitoring ? (
				<Alert variant="warning" icon={IconAlertTriangle}>
					{result.restartNeeded ? (
						<div>
							<T id="settings.backup.restore.restart" />
						</div>
					) : null}
					{monitoring ? (
						<div>
							<T id="settings.backup.restore.restart-traffic" />
						</div>
					) : null}
				</Alert>
			) : null}
			{result.runtimeFailed?.length ? (
				<Alert variant="warning" icon={IconAlertTriangle}>
					<T
						id="settings.backup.restore.runtime-failed"
						data={{ groups: [...new Set(result.runtimeFailed.map(groupLabel))].join(", ") }}
					/>
				</Alert>
			) : null}
			{result.offlineHosts?.length ? (
				<Alert variant="warning" icon={IconAlertTriangle}>
					<div className="fw-bold mb-1">
						<T id="settings.backup.restore.offline-hosts" data={{ count: result.offlineHosts.length }} />
					</div>
					<ul className="mb-0 overflow-auto" style={{ maxHeight: "16em" }}>
						{result.offlineHosts.map((host) => {
							const list = HOST_LISTS[host.type];
							return (
								<li key={`${host.type}-${host.id}`} className="mb-1">
									<span className="fw-medium">{host.domain}</span>
									{list ? (
										<span className="ms-1">
											(
											<button
												type="button"
												className="btn btn-link p-0 align-baseline"
												onClick={() => onOpen(list.path)}
											>
												<T id={list.labelId} />
											</button>
											)
										</span>
									) : null}
									{host.error ? (
										// pre-wrap is inline: Tabler's .text-wrap is white-space: normal and would flatten the nginx output
										<pre className="mt-1 mb-0 small text-break" style={{ whiteSpace: "pre-wrap" }}>
											{host.error}
										</pre>
									) : null}
								</li>
							);
						})}
					</ul>
				</Alert>
			) : null}
			<ItemList titleId="settings.backup.restore.references.done" items={referenceItems(result.references)} />
			<ItemList titleId="settings.backup.restore.skipped-users" items={userItems(result.skippedUsers)} />
			{merged ? <MergeNotes plan={plan} cleared={result.cleared} needsSecrets={result.needsSecrets} /> : null}
		</>
	);
}

/**
 * Restore a stored backup (entry) or import a file on a list page (importKind and file, merge only, see
 * showImportItemsModal): the passphrase when the file is encrypted with one, then Replace or Merge (a file of single
 * items only merges). Replace shows what it holds as the type tree (all ticked) with what a restore of the selection
 * clears or skips; Merge shows the merge view (MergeView) with its dry run. Then a confirmation and the restore.
 * Closing before the restore releases the unpacked backup; while it runs the dialog cannot be closed.
 */
const RestoreBackupModal = EasyModal.create(({ entry, importKind, file, navigate, visible, remove }) => {
	const importing = Boolean(importKind);
	// an import's file says whether it has a passphrase once it is uploaded
	const [encrypted, setEncrypted] = useState(
		!importing && entry.encrypted === true && !entry.auto && !entry.instanceKey,
	);
	const needsPassphrase = encrypted;
	const baseId = useId();
	// the parts of a Settings backup (administrators only); an import shows its kinds without them
	const { data: typesData, error: typesError } = useBackupTypes(!importing);
	const restore = useRestoreBackup();
	const upload = useImportUpload();
	const queryClient = useQueryClient();
	const [step, setStep] = useState(importing ? "uploading" : needsPassphrase ? "passphrase" : "opening");
	const [progress, setProgress] = useState(0);
	const [passphrase, setPassphrase] = useState("");
	const [openError, setOpenError] = useState(null);
	const [opened, setOpened] = useState(null);
	const [selected, setSelected] = useState([]);
	const [preview, setPreview] = useState(null);
	const [checking, setChecking] = useState(false);
	const [checkError, setCheckError] = useState(null);
	const [confirmed, setConfirmed] = useState(false);
	const [result, setResult] = useState(null);
	// the mode the shown result was made with
	const [resultMode, setResultMode] = useState(null);
	const [restoreError, setRestoreError] = useState(null);
	const [mode, setMode] = useState("replace");
	// the token of an opened backup that was not restored, released when the dialog closes
	const tokenRef = useRef(null);
	// the selection the shown preview belongs to
	const checkedRef = useRef(null);
	const started = useRef(false);
	// closed while the backup was still being opened: its token is released as soon as it arrives
	const closed = useRef(false);
	// the uploaded import file, kept by the server until it is opened (a wrong passphrase keeps it for another try)
	const uploadRef = useRef(null);
	const abortRef = useRef(null);
	const running = step === "running";

	const open = async (secret) => {
		setOpenError(null);
		setStep("opening");
		try {
			const res = importing
				? await openImport(uploadRef.current, secret)
				: await inspectBackup(entry.name, secret);
			if (closed.current) {
				cancelRestore(res.token).catch(() => undefined);
				return;
			}
			// a page import selects only its kind; the linked items come along with the items that need them
			const types = importing ? [importKind] : res.manifest.types;
			tokenRef.current = res.token;
			checkedRef.current = types;
			setOpened(res);
			setSelected(types);
			// a file of single items and a page import can only be merged
			setMode(importing || res.manifest.partial === true ? "merge" : "replace");
			setPreview(res.preview ?? null);
			setStep("preview");
		} catch (err) {
			if (closed.current) return;
			setOpenError(withErrorDetails(err));
			// an import's upload is used up by any error but a wrong passphrase
			const retry =
				secret !== undefined &&
				(!importing || err?.payload?.error?.message_i18n === "backup.error.wrong-passphrase");
			setStep(retry ? "passphrase" : "open-failed");
		}
	};

	// an import is uploaded first; it then opens at once or after its passphrase
	const uploadFile = async () => {
		if (file.size > MAX_IMPORT) {
			setOpenError(tooLargeError());
			setStep("open-failed");
			return;
		}
		abortRef.current = new AbortController();
		try {
			const res = await upload.mutateAsync({
				kind: importKind,
				file,
				onProgress: setProgress,
				abortController: abortRef.current,
			});
			if (closed.current) return;
			uploadRef.current = res.id;
			setEncrypted(res.encrypted);
			if (res.encrypted) setStep("passphrase");
			else void open(undefined);
		} catch (err) {
			if (closed.current || err?.name === "AbortError") return;
			setOpenError(isTooLarge(err) ? tooLargeError() : withErrorDetails(err));
			setStep("open-failed");
		} finally {
			abortRef.current = null;
		}
	};

	// a backup without a passphrase opens at once
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the dialog opens
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		if (importing) void uploadFile();
		else if (!needsPassphrase) void open(undefined);
	}, []);

	const merge = useMergePlan({ token: opened?.token, types: selected, enabled: mode === "merge" });

	// the preview of a replace follows the selection, asked again 300 ms after the last change
	useEffect(() => {
		if (!opened || mode !== "replace" || selected === checkedRef.current) return;
		if (selected.length === 0) {
			setChecking(false);
			return;
		}
		let current = true;
		setChecking(true);
		const timer = setTimeout(async () => {
			try {
				const next = await checkRestore(opened.token, selected);
				if (!current) return;
				checkedRef.current = selected;
				setPreview(next);
				setCheckError(null);
			} catch (err) {
				if (current) setCheckError(withErrorDetails(err));
			} finally {
				if (current) setChecking(false);
			}
		}, 300);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [opened, mode, selected]);

	const close = () => {
		if (running) return;
		closed.current = true;
		abortRef.current?.abort();
		const token = tokenRef.current;
		tokenRef.current = null;
		// releasing early only frees the unpacked copy sooner: it expires on the server anyway
		if (token) cancelRestore(token).catch(() => undefined);
		remove();
	};

	const run = async () => {
		const token = tokenRef.current;
		// a restore uses the token up, whether it succeeds or not
		tokenRef.current = null;
		setRestoreError(null);
		setResultMode(mode);
		setStep("running");
		try {
			setResult(
				await restore.mutateAsync(
					mode === "merge"
						? { token, mode, ...merge.request, planHash: merge.plan.hash }
						: { token, types: selected },
				),
			);
			setStep("done");
		} catch (err) {
			const plan = err?.payload?.error?.message_i18n === "backup.error.plan-changed" && err.payload.error.plan;
			if (plan) {
				// nothing was applied and the backup stays open: the new plan is shown for a new confirmation
				tokenRef.current = token;
				merge.planChanged(plan);
				setConfirmed(false);
				setStep("preview");
				return;
			}
			// the automatic backup made before the restore is listed now; after a failed rollback anything may differ
			const rollbackFailed = err?.payload?.error?.message_i18n === "backup.error.rollback-failed";
			void queryClient.invalidateQueries(rollbackFailed ? undefined : { queryKey: ["backups"] });
			setRestoreError(withErrorDetails(err));
			setStep("failed");
		}
	};

	const openRoute = (path) => {
		close();
		navigate?.(path);
	};

	const reasonId = `${baseId}-reason`;
	const passphraseShort = [...passphrase].length < PASSPHRASE_MIN_LENGTH;
	const merging = mode === "merge";
	const stale = merging ? merge.stale : checking || selected !== checkedRef.current;
	const manifest = opened?.manifest;
	let categories = null;
	if (manifest && importing) categories = importCategories(importKind);
	else if (manifest && typesData) categories = categoriesOf(typesData.categories, manifest.types);
	const baseReason = restoreBlockReason({
		selected,
		shown: categories ? categories.flatMap((category) => category.types) : null,
		partsFailed: Boolean(typesError),
		checkFailed: Boolean(merging ? merge.error : checkError),
		stale,
		confirmed,
	});
	const emptyType = merging ? emptyItemType(merge.items, selected) : null;
	let restoreReason = merging ? (MERGE_REASONS[baseReason] ?? baseReason) : baseReason;
	if (emptyType && !EARLY_REASONS.includes(baseReason)) restoreReason = "settings.backup.reason.no-items";

	// the confirmation covers the selection and the mode it was given for
	const changeTypes = (next) => {
		setSelected(next);
		setConfirmed(false);
	};
	const changeMode = (next) => {
		setMode(next);
		setConfirmed(false);
	};

	let body = null;
	let footer = null;
	if (step === "uploading") {
		body = <Uploading progress={progress} />;
		footer = (
			<Button className="ms-auto" onClick={close}>
				<T id="cancel" />
			</Button>
		);
	} else if (step === "passphrase") {
		const formId = `${baseId}-form`;
		body = (
			<form
				id={formId}
				noValidate
				onSubmit={(e) => {
					e.preventDefault();
					if (!passphraseShort) void open(passphrase);
				}}
			>
				<p className="text-secondary">
					<T id="settings.backup.restore.passphrase.hint" />
				</p>
				<div className="mb-3">
					<PasswordInput
						id={`${baseId}-passphrase`}
						name="passphrase"
						label={<T id="settings.backup.passphrase" />}
						autoComplete="off"
						value={passphrase}
						onChange={(e) => setPassphrase(e.target.value)}
					/>
				</div>
				<ErrorAlert error={openError} className="mb-0" />
			</form>
		);
		footer = (
			<>
				<Button onClick={close}>
					<T id="cancel" />
				</Button>
				<div className="ms-auto d-flex align-items-center">
					{passphraseShort ? (
						<span id={reasonId} className="text-secondary small me-3 text-end">
							<T id="settings.backup.passphrase.too-short" />
						</span>
					) : null}
					<Button
						type="submit"
						form={formId}
						color="teal"
						disabled={passphraseShort}
						aria-describedby={passphraseShort ? reasonId : undefined}
					>
						<T id="settings.backup.restore.continue" />
					</Button>
				</div>
			</>
		);
	} else if (step === "opening") {
		body = (
			<div className="py-3">
				<p className="text-secondary text-center" role="status">
					<T id="settings.backup.restore.opening" />
				</p>
				<Loading noLogo />
			</div>
		);
		footer = (
			<Button className="ms-auto" onClick={close}>
				<T id="cancel" />
			</Button>
		);
	} else if (step === "open-failed") {
		body = <ErrorAlert error={openError} className="mb-0" />;
		footer = (
			<Button className="ms-auto" onClick={close}>
				<T id="action.close" />
			</Button>
		);
	} else if (step === "preview") {
		const createdBy = manifest.createdBy?.name || manifest.createdBy?.email || "?";
		body = (
			<>
				<p className="text-secondary">
					<T
						id="settings.backup.restore.made-with"
						data={{
							version: manifest.npmproVersion,
							date: manifest.createdAt ? formatDateTime(manifest.createdAt) : "?",
							name: createdBy,
						}}
					/>
				</p>
				{importing ? null : (
					<ModeSwitch mode={mode} partial={manifest.partial === true} onChange={changeMode} />
				)}
				<ErrorAlert error={typesError} />
				{merging ? (
					<MergeView
						merge={merge}
						categories={categories ?? []}
						counts={manifest.counts}
						selected={selected}
						onTypesChange={changeTypes}
						onEdit={() => setConfirmed(false)}
						partsLabelId={importing ? "backup.import.parts" : undefined}
					/>
				) : (
					<>
						<TypeTree
							label={<T id="settings.backup.restore.parts" />}
							categories={categories ?? []}
							counts={manifest.counts}
							selected={selected}
							onChange={changeTypes}
						/>
						<ErrorAlert error={checkError} />
						{preview && selected.length > 0 ? <PreviewLists preview={preview} /> : null}
					</>
				)}
				{merging ? (
					<Alert variant="warning" icon={IconAlertTriangle}>
						<T id="settings.backup.merge.warning" />
					</Alert>
				) : (
					<Alert variant="danger" icon={IconAlertCircle}>
						<T id="settings.backup.restore.warning" />
					</Alert>
				)}
				<label className="form-check mb-0">
					<input
						className="form-check-input"
						type="checkbox"
						checked={confirmed}
						onChange={(e) => setConfirmed(e.target.checked)}
					/>
					<span className="form-check-label">
						<T id={merging ? "settings.backup.merge.confirm" : "settings.backup.restore.confirm"} />
					</span>
				</label>
			</>
		);
		footer = (
			<>
				<Button onClick={close}>
					<T id="cancel" />
				</Button>
				<div className="ms-auto d-flex align-items-center">
					{restoreReason ? (
						<span id={reasonId} className="text-secondary small me-3 text-end">
							<T id={restoreReason} data={emptyType ? { type: typeLabel(emptyType) } : undefined} />
						</span>
					) : null}
					<Button
						color="danger"
						disabled={restoreReason !== null}
						aria-describedby={restoreReason ? reasonId : undefined}
						onClick={run}
					>
						<T id={importing ? "backup.import" : "settings.backup.restore"} />
					</Button>
				</div>
			</>
		);
	} else if (step === "running") {
		body = <Running />;
		footer = (
			<Button className="ms-auto" disabled>
				<T id="action.close" />
			</Button>
		);
	} else {
		body =
			step === "done" ? (
				<Result
					result={result}
					types={selected}
					plan={resultMode === "merge" ? merge.plan : null}
					onOpen={openRoute}
				/>
			) : (
				<ErrorAlert error={restoreError} className="mb-0" />
			);
		footer = (
			<Button className="ms-auto" onClick={close}>
				<T id="action.close" />
			</Button>
		);
	}

	return (
		<AppModal show={visible} onHide={close} size="xl" backdrop={running ? "static" : true} keyboard={!running}>
			<AppModal.Header closeButton={!running}>
				<AppModal.Title>
					{importing ? (
						<T id="backup.import.title" data={{ objects: typeLabel(importKind) }} />
					) : (
						<T id="settings.backup.restore.title" />
					)}
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<div className="text-secondary small text-break mb-3">{importing ? file.name : entry.name}</div>
				{body}
			</AppModal.Body>
			<AppModal.Footer>{footer}</AppModal.Footer>
		</AppModal>
	);
});

export { showImportItemsModal, showRestoreBackupModal };
