import { IconAlertCircle, IconAlertTriangle, IconCircleCheck } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { cancelRestore, checkRestore, inspectBackup } from "src/api/backend";
import { AppModal, Button, ErrorAlert, Loading, PasswordInput } from "src/components";
import { useBackupTypes, useRestoreBackup } from "src/hooks";
import { useElapsed } from "src/hooks/useElapsed";
import { formatDateTime, intl, T } from "src/locale";
import { categoriesOf, PASSPHRASE_MIN_LENGTH, restoreBlockReason, withErrorDetails } from "src/modules/BackupTypes";
import { formatElapsed } from "src/modules/Duration";
import EasyModal from "src/modules/easyModal";
import { TypeTree } from "src/pages/Settings/Backup/TypeTree";

/**
 * @param {Object}   entry       a stored backup as listed by GET /api/backups
 * @param {Function} [navigate]  opens an app route (the modal is outside the router), for the host list links
 */
const showRestoreBackupModal = (entry, navigate) => {
	EasyModal.show(RestoreBackupModal, { entry, navigate });
};

// the host list of each host table, for hosts left offline after a restore
const HOST_LISTS = {
	proxy_host: { path: "/nginx/proxy", labelId: "proxy-hosts" },
	redirection_host: { path: "/nginx/redirection", labelId: "redirection-hosts" },
	dead_host: { path: "/nginx/404", labelId: "dead-hosts" },
	stream: { path: "/nginx/stream", labelId: "streams" },
};

const typeLabel = (typeId) => intl.formatMessage({ id: `settings.backup.type.${typeId}` });

// a settings group by its name in the Environment section, the raw id when there is none
const groupLabel = (group) => {
	const id = `settings.environment.group.${group}`;
	return intl.messages[id] ? intl.formatMessage({ id }) : group;
};

function ItemList({ titleId, items, className = "mb-3" }) {
	if (items.length === 0) return null;
	return (
		<div className={className}>
			<div className="fw-bold mb-1">
				<T id={titleId} data={{ count: items.length }} />
			</div>
			{/* no utility gives a capped height: a long list scrolls instead of stretching the dialog */}
			<ul className="mb-0 overflow-auto" style={{ maxHeight: "12em" }}>
				{items.map((item) => (
					<li key={item.key} className="text-break">
						{item.text}
					</li>
				))}
			</ul>
		</div>
	);
}

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

function Result({ result, types, onOpen }) {
	const monitoring = types.includes("settings_monitoring");
	const counts = Object.entries(result.counts ?? {});
	return (
		<>
			<Alert variant="success" icon={IconCircleCheck}>
				<div className="fw-bold">
					<T id="settings.backup.restore.done" />
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
		</>
	);
}

/**
 * Restore a stored backup (replace): the passphrase when the file is encrypted with one, then what it holds as the
 * type tree (all ticked) with what a restore of the selection clears or skips, a confirmation and the restore. Closing
 * before the restore releases the unpacked backup; while it runs the dialog cannot be closed.
 */
const RestoreBackupModal = EasyModal.create(({ entry, navigate, visible, remove }) => {
	const needsPassphrase = entry.encrypted === true && !entry.auto;
	const baseId = useId();
	const { data: typesData, error: typesError } = useBackupTypes();
	const restore = useRestoreBackup();
	const queryClient = useQueryClient();
	const [step, setStep] = useState(needsPassphrase ? "passphrase" : "opening");
	const [passphrase, setPassphrase] = useState("");
	const [openError, setOpenError] = useState(null);
	const [opened, setOpened] = useState(null);
	const [selected, setSelected] = useState([]);
	const [preview, setPreview] = useState(null);
	const [checking, setChecking] = useState(false);
	const [checkError, setCheckError] = useState(null);
	const [confirmed, setConfirmed] = useState(false);
	const [result, setResult] = useState(null);
	const [restoreError, setRestoreError] = useState(null);
	// the token of an opened backup that was not restored, released when the dialog closes
	const tokenRef = useRef(null);
	// the selection the shown preview belongs to
	const checkedRef = useRef(null);
	const started = useRef(false);
	// closed while the backup was still being opened: its token is released as soon as it arrives
	const closed = useRef(false);
	const running = step === "running";

	const open = async (secret) => {
		setOpenError(null);
		setStep("opening");
		try {
			const res = await inspectBackup(entry.name, secret);
			if (closed.current) {
				cancelRestore(res.token).catch(() => undefined);
				return;
			}
			tokenRef.current = res.token;
			checkedRef.current = res.manifest.types;
			setOpened(res);
			setSelected(res.manifest.types);
			setPreview(res.preview);
			setStep("preview");
		} catch (err) {
			if (closed.current) return;
			setOpenError(withErrorDetails(err));
			setStep(needsPassphrase ? "passphrase" : "open-failed");
		}
	};

	// a backup without a passphrase opens at once
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the dialog opens
	useEffect(() => {
		if (needsPassphrase || started.current) return;
		started.current = true;
		void open(undefined);
	}, []);

	// the preview follows the selection, asked again 300 ms after the last change
	useEffect(() => {
		if (!opened || selected === checkedRef.current) return;
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
	}, [opened, selected]);

	const close = () => {
		if (running) return;
		closed.current = true;
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
		setStep("running");
		try {
			setResult(await restore.mutateAsync({ token, types: selected }));
			setStep("done");
		} catch (err) {
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
	const stale = checking || selected !== checkedRef.current;
	const manifest = opened?.manifest;
	const categories = typesData && manifest ? categoriesOf(typesData.categories, manifest.types) : [];
	const restoreReason = restoreBlockReason({
		selected,
		shown: typesData && manifest ? categories.flatMap((category) => category.types) : null,
		partsFailed: Boolean(typesError),
		checkFailed: Boolean(checkError),
		stale,
		confirmed,
	});

	let body = null;
	let footer = null;
	if (step === "passphrase") {
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
				<ErrorAlert error={typesError} />
				<TypeTree
					label={<T id="settings.backup.restore.parts" />}
					categories={categories}
					counts={manifest.counts}
					selected={selected}
					onChange={(next) => {
						setSelected(next);
						// the confirmation covers the selection it was given for
						setConfirmed(false);
					}}
				/>
				<ErrorAlert error={checkError} />
				{preview && selected.length > 0 ? <PreviewLists preview={preview} /> : null}
				<Alert variant="danger" icon={IconAlertCircle}>
					<T id="settings.backup.restore.warning" />
				</Alert>
				<label className="form-check mb-0">
					<input
						className="form-check-input"
						type="checkbox"
						checked={confirmed}
						onChange={(e) => setConfirmed(e.target.checked)}
					/>
					<span className="form-check-label">
						<T id="settings.backup.restore.confirm" />
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
							<T id={restoreReason} />
						</span>
					) : null}
					<Button
						color="danger"
						disabled={restoreReason !== null}
						aria-describedby={restoreReason ? reasonId : undefined}
						onClick={run}
					>
						<T id="settings.backup.restore" />
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
				<Result result={result} types={selected} onOpen={openRoute} />
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
		<AppModal show={visible} onHide={close} size="lg" backdrop={running ? "static" : true} keyboard={!running}>
			<AppModal.Header closeButton={!running}>
				<AppModal.Title>
					<T id="settings.backup.restore.title" />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<div className="text-secondary small text-break mb-3">{entry.name}</div>
				{body}
			</AppModal.Body>
			<AppModal.Footer>{footer}</AppModal.Footer>
		</AppModal>
	);
});

export { showRestoreBackupModal };
