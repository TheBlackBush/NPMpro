import { Form, Formik, useFormikContext } from "formik";
import { useEffect, useId, useState } from "react";
import { downloadPendingBackup, exportItems, exportPreview } from "src/api/backend";
import {
	AppModal,
	Button,
	ErrorAlert,
	FormErrorNote,
	ItemChecklist,
	Loading,
	showFirstInvalid,
	useShownErrors,
} from "src/components";
import { useExportPreview, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { withErrorDetails } from "src/modules/BackupTypes";
import EasyModal from "src/modules/easyModal";
import { isAdmin } from "src/modules/Permissions";
import { SecretsFields, validateSecrets } from "src/pages/Settings/Backup/SecretsFields";

/**
 * @param {string} kind  the page's kind of items: proxy_hosts, redirection_hosts, dead_hosts, streams, certificates,
 *                       access_lists or dns_credentials
 */
const showExportItemsModal = (kind) => {
	EasyModal.show(ExportItemsModal, { kind });
};

const typeLabel = (typeId) => intl.formatMessage({ id: `settings.backup.type.${typeId}` });
const itemKey = (type, id) => `${type}:${id}`;

// the linked items the export takes along, by type: all ticked ones
const linkedRequest = (linked, unticked) => {
	const request = { certificates: [], access_lists: [], dns_credentials: [] };
	for (const item of linked) {
		if (!unticked.has(itemKey(item.type, item.id))) request[item.type]?.push(item.id);
	}
	return request;
};

/**
 * The linked items of the chosen items (and whether secrets may be included), asked again 300 ms after the last
 * change of the selection. stale: the shown list does not belong to the selection yet.
 */
function useLinked(kind, ids, initial) {
	const [state, setState] = useState({ ids, preview: initial, error: null });
	const [checking, setChecking] = useState(false);
	useEffect(() => {
		if (ids === state.ids) return;
		if (ids.length === 0) {
			setChecking(false);
			return;
		}
		let current = true;
		setChecking(true);
		const timer = setTimeout(async () => {
			try {
				const preview = await exportPreview(kind, ids);
				if (current) setState({ ids, preview, error: null });
			} catch (err) {
				if (current) setState((prev) => ({ ...prev, error: withErrorDetails(err) }));
			} finally {
				if (current) setChecking(false);
			}
		}, 300);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [kind, ids, state.ids]);
	return { ...state, stale: checking || (ids.length > 0 && ids !== state.ids) };
}

// one linked item: the include box, its name, its type and the chosen items that need it
function LinkedRow({ item, labelOf, checked, onChange, disabled }) {
	const descriptionId = useId();
	return (
		<label className="list-group-item">
			<span className="list-group-item-media">
				<input
					type="checkbox"
					className="form-check-input list-group-selectable-check m-0"
					checked={checked}
					onChange={(e) => onChange(e.target.checked)}
					disabled={disabled}
					aria-describedby={descriptionId}
				/>
			</span>
			<span className="list-group-item-content">
				<span className="list-group-item-title text-wrap text-break">{item.label}</span>
				<span id={descriptionId} className="list-group-item-description text-wrap text-break small">
					{`${typeLabel(item.type)} · `}
					<T
						id="settings.backup.merge.needed-by"
						data={{ names: (item.neededBy ?? []).map(labelOf).join(", ") }}
					/>
				</span>
			</span>
		</label>
	);
}

function ExportForm({ kind, base, ids, setIds, linked, shownLinked, unticked, setUnticked, reason, error, onClose }) {
	const { isSubmitting, setFieldValue, values } = useFormikContext();
	const baseId = useId();
	const titleId = `${baseId}-title`;
	const linkedTitleId = `${baseId}-linked`;
	const noteId = `${baseId}-note`;
	const reasonId = `${baseId}-reason`;
	const blocked = useShownErrors(true).length > 0;
	const secretsAllowed = linked.preview.secretsAllowed;

	// secrets cannot be included once a chosen item comes from a kind without manage permission
	useEffect(() => {
		if (!secretsAllowed && values.secrets) void setFieldValue("secrets", false);
	}, [secretsAllowed, values.secrets, setFieldValue]);

	const labels = new Map([
		...base.items.map((item) => [itemKey(kind, item.id), item.label]),
		...shownLinked.map((item) => [itemKey(item.type, item.id), item.label]),
	]);
	const labelOf = (key) => labels.get(key) ?? key;

	const showReason = reason !== null && !blocked && !isSubmitting;
	const describedBy = blocked ? noteId : showReason ? reasonId : undefined;

	return (
		<Form noValidate>
			<AppModal.Header closeButton={!isSubmitting}>
				<AppModal.Title>
					<T id="backup.export.title" data={{ objects: typeLabel(kind) }} />
				</AppModal.Title>
			</AppModal.Header>
			<AppModal.Body>
				<div className="card card-sm mb-3">
					<div className="card-header py-2">
						<div id={titleId} className="card-title">
							{typeLabel(kind)}
						</div>
					</div>
					<ItemChecklist
						labelledBy={titleId}
						items={base.items}
						selected={ids}
						onChange={setIds}
						disabled={isSubmitting}
					/>
				</div>
				<ErrorAlert error={linked.error} />
				{shownLinked.length > 0 ? (
					<div className="mb-3">
						<div id={linkedTitleId} className="form-label">
							<T id="backup.export.needed-by" />
						</div>
						<fieldset
							aria-labelledby={linkedTitleId}
							className="list-group list-group-selectable overflow-auto"
							style={{ maxHeight: "16rem" }}
						>
							{shownLinked.map((item) => {
								const key = itemKey(item.type, item.id);
								return (
									<LinkedRow
										key={key}
										item={item}
										labelOf={labelOf}
										checked={!unticked.has(key)}
										onChange={(checked) =>
											setUnticked((prev) => {
												const next = new Set(prev);
												if (checked) next.delete(key);
												else next.add(key);
												return next;
											})
										}
										disabled={isSubmitting}
									/>
								);
							})}
						</fieldset>
					</div>
				) : null}
				{secretsAllowed ? (
					<SecretsFields offNoteId="backup.export.no-secrets-note" disabled={isSubmitting} />
				) : (
					<p className="text-secondary small mb-3">
						<T id="backup.export.no-secrets-note" />
					</p>
				)}
				<ErrorAlert error={error} className="mb-0" />
			</AppModal.Body>
			<AppModal.Footer>
				<Button onClick={onClose} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<div className="ms-auto d-flex flex-wrap align-items-center justify-content-end gap-2">
					<FormErrorNote id={noteId} late className="me-2 text-end" />
					{showReason ? (
						<span id={reasonId} className="text-secondary small me-2 text-end">
							<T id={reason} />
						</span>
					) : null}
					<Button
						type="submit"
						color="teal"
						isLoading={isSubmitting}
						disabled={reason !== null && !blocked}
						blocked={blocked}
						onBlockedClick={(e) => showFirstInvalid(e.currentTarget.closest("form"))}
						onMouseDown={(e) => e.preventDefault()}
						aria-describedby={describedBy}
					>
						<T id="action.download" />
					</Button>
				</div>
			</AppModal.Footer>
		</Form>
	);
}

// the export of the loaded items: the selection, its linked items and the form
function ExportContent({ kind, base, admin, onClose }) {
	const [ids, setIds] = useState(() => base.items.map((item) => item.id));
	const [unticked, setUnticked] = useState(() => new Set());
	const [error, setError] = useState(null);
	const linked = useLinked(kind, ids, base);
	const shownLinked = ids.length > 0 ? linked.preview.linked : [];
	let reason = null;
	if (ids.length === 0) reason = "backup.export.reason.no-items";
	else if (linked.stale) reason = "backup.export.reason.checking";

	const onSubmit = async (values) => {
		if (reason !== null) return;
		setError(null);
		try {
			const result = await exportItems({
				kind,
				ids,
				linked: linkedRequest(shownLinked, unticked),
				secrets: values.secrets,
				passphrase: values.secrets ? values.passphrase : undefined,
			});
			await downloadPendingBackup(result.pending, result.name);
			onClose();
		} catch (err) {
			setError(withErrorDetails(err));
		}
	};

	return (
		<Formik
			initialValues={{ secrets: admin, passphrase: "", passphraseRepeat: "" }}
			validate={validateSecrets}
			onSubmit={onSubmit}
		>
			<ExportForm
				kind={kind}
				base={base}
				ids={ids}
				setIds={setIds}
				linked={linked}
				shownLinked={shownLinked}
				unticked={unticked}
				setUnticked={setUnticked}
				reason={reason}
				error={error}
				onClose={onClose}
			/>
		</Formik>
	);
}

/**
 * Export items of a list page: the page's items (all ticked), the certificates, access lists and DNS credentials they
 * need under "Needed by" (ticked, can be unticked), secrets with a passphrase when the user may manage every kind in
 * the file, then the file is downloaded. Nothing is kept on the server.
 */
const ExportItemsModal = EasyModal.create(({ kind, visible, remove }) => {
	const { data: base, error, isPending } = useExportPreview(kind);
	const { data: me, isPending: mePending } = useUser("me");
	return (
		<AppModal show={visible} onHide={remove} size="lg" backdrop="static">
			{isPending || mePending ? (
				<AppModal.Body>
					<Loading noLogo />
				</AppModal.Body>
			) : null}
			{error ? (
				<AppModal.Body>
					<ErrorAlert error={error} className="mb-0" />
				</AppModal.Body>
			) : null}
			{base && !mePending ? (
				<ExportContent kind={kind} base={base} admin={isAdmin(me?.roles)} onClose={remove} />
			) : null}
		</AppModal>
	);
});

export { showExportItemsModal };
