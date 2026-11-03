import { useEffect, useId, useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { downloadPendingBackup, exportItems, exportPreview } from "src/api/backend";
import {
	AppModal,
	Button,
	ErrorAlert,
	FormErrorNote,
	focusFirstError,
	HookForm,
	ItemChecklist,
	Loading,
	PASSPHRASE_FIELDS,
	SecretsFields,
	useAppForm,
	useFieldOrder,
	validateSecrets,
} from "src/components";
import { Checkbox } from "src/components/ui/checkbox";
import { useExportPreview, useUser } from "src/hooks";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { withErrorDetails } from "src/modules/BackupTypes";
import EasyModal from "src/modules/easyModal";
import { errorPaths } from "src/modules/HookForm";
import { isAdmin } from "src/modules/Permissions";
import { kindSection, sectionAccent } from "src/modules/SectionAccents";
import { sectionIcon } from "src/shell/useNavItems";

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
 * change of the selection. stale: the shown list does not belong to the selection yet; failed: the last request for
 * the selection failed, retry() asks again.
 */
function useLinked(kind, ids, initial) {
	const [state, setState] = useState({ ids, preview: initial });
	const [failure, setFailure] = useState(null);
	const [checking, setChecking] = useState(false);
	const failed = failure !== null && failure.ids === ids;
	useEffect(() => {
		if (ids === state.ids || ids.length === 0 || failed) {
			setChecking(false);
			return;
		}
		let current = true;
		setChecking(true);
		const timer = setTimeout(async () => {
			try {
				const preview = await exportPreview(kind, ids);
				if (!current) return;
				setState({ ids, preview });
				setFailure(null);
			} catch (err) {
				if (current) setFailure({ ids, error: withErrorDetails(err) });
			} finally {
				if (current) setChecking(false);
			}
		}, 300);
		return () => {
			current = false;
			clearTimeout(timer);
		};
	}, [kind, ids, state.ids, failed]);
	return {
		preview: state.preview,
		error: failed ? failure.error : null,
		failed,
		stale: !failed && (checking || (ids.length > 0 && ids !== state.ids)),
		retry: () => setFailure(null),
	};
}

// the title and the close button, in every state of the window
function ExportHeader({ kind, closable = true }) {
	const section = kindSection(kind);
	const Icon = section ? sectionIcon(section) : undefined;
	return (
		<AppModal.Header closeButton={closable}>
			<AppModal.Title className="flex items-center gap-2">
				{Icon ? (
					<Icon className={cn("size-5 shrink-0", sectionAccent(section).text)} aria-hidden="true" />
				) : null}
				<T id="backup.export.title" data={{ objects: typeLabel(kind) }} />
			</AppModal.Title>
		</AppModal.Header>
	);
}

// one linked item: the include box, its name, its type and the chosen items that need it
function LinkedRow({ item, labelOf, checked, onChange, disabled }) {
	const descriptionId = useId();
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the Radix checkbox inside is a button, which labels the row
		<label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
			<Checkbox
				checked={checked}
				onCheckedChange={(v) => onChange(v === true)}
				disabled={disabled}
				aria-describedby={descriptionId}
				className="mt-0.5"
			/>
			<span className="min-w-0">
				<span className="block text-sm break-words">{item.label}</span>
				<span id={descriptionId} className="block text-xs text-muted-foreground break-words">
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
	const { setValue, setFocus, clearErrors } = useFormContext();
	const { isSubmitting, errors } = useFormState();
	const secrets = useWatch({ name: "secrets" });
	const order = useFieldOrder();
	const baseId = useId();
	const titleId = `${baseId}-title`;
	const linkedTitleId = `${baseId}-linked`;
	const noteId = `${baseId}-note`;
	const reasonId = `${baseId}-reason`;
	const blocked = errorPaths(errors).length > 0;
	const secretsAllowed = linked.preview.secretsAllowed;

	// secrets cannot be included once a chosen item comes from a kind without manage permission; the hidden
	// passphrase fields take their messages with them, so they do not block Download
	useEffect(() => {
		if (secretsAllowed || !secrets) return;
		setValue("secrets", false);
		clearErrors(PASSPHRASE_FIELDS);
	}, [secretsAllowed, secrets, setValue, clearErrors]);

	const labels = new Map([
		...base.items.map((item) => [itemKey(kind, item.id), item.label]),
		...shownLinked.map((item) => [itemKey(item.type, item.id), item.label]),
	]);
	const labelOf = (key) => labels.get(key) ?? key;

	const showReason = reason !== null && !blocked && !isSubmitting;
	const describedBy = blocked ? noteId : showReason ? reasonId : undefined;

	return (
		<>
			<ExportHeader kind={kind} closable={!isSubmitting} />
			<AppModal.Body>
				<section aria-labelledby={titleId} className="mb-3 overflow-hidden rounded-lg border">
					<div className="border-b bg-muted/40 px-3 py-2">
						<h3 id={titleId} className="text-sm font-medium">
							{typeLabel(kind)}
						</h3>
					</div>
					<ItemChecklist
						labelledBy={titleId}
						items={base.items}
						selected={ids}
						onChange={setIds}
						typeName={typeLabel(kind)}
						disabled={isSubmitting}
					/>
				</section>
				{linked.error ? (
					<div className="mb-3 flex flex-col items-start gap-2">
						<ErrorAlert error={linked.error} />
						<Button variant="outline" size="sm" onClick={linked.retry}>
							<T id="backup.export.retry" />
						</Button>
					</div>
				) : null}
				{shownLinked.length > 0 ? (
					<>
						<div id={linkedTitleId} className="mb-1.5 text-sm font-medium">
							<T id="backup.export.needed-by" />
						</div>
						<fieldset
							aria-labelledby={linkedTitleId}
							className="mb-3 max-h-64 divide-y overflow-auto rounded-lg border"
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
					</>
				) : null}
				{secretsAllowed ? (
					<SecretsFields
						offNoteId="backup.export.no-secrets-note"
						passphraseHintId="backup.export.passphrase.hint"
						disabled={isSubmitting}
					/>
				) : (
					<p className="mb-3 text-sm text-muted-foreground">
						<T id="backup.export.no-secrets-note" />
					</p>
				)}
				<ErrorAlert error={error} className="mb-0" />
			</AppModal.Body>
			<AppModal.Footer>
				<Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
					<FormErrorNote id={noteId} className="text-right" />
					{showReason ? (
						<span id={reasonId} className="text-right text-sm text-muted-foreground">
							<T id={reason} />
						</span>
					) : null}
					<Button
						type="submit"
						color="primary"
						isLoading={isSubmitting}
						disabled={reason !== null && !blocked}
						blocked={blocked}
						onBlockedClick={() => focusFirstError(errors, order, setFocus)}
						onMouseDown={(e) => e.preventDefault()}
						aria-describedby={describedBy}
					>
						<T id="action.download" />
					</Button>
				</div>
			</AppModal.Footer>
		</>
	);
}

// the export of the loaded items: the selection, its linked items and the form
function ExportContent({ kind, base, admin, onClose }) {
	const [ids, setIds] = useState(() => base.items.map((item) => item.id));
	const [unticked, setUnticked] = useState(() => new Set());
	const [error, setError] = useState(null);
	const linked = useLinked(kind, ids, base);
	const methods = useAppForm({
		defaultValues: { secrets: admin, passphrase: "", passphraseRepeat: "" },
		validate: validateSecrets,
	});
	const shownLinked = ids.length > 0 ? linked.preview.linked : [];
	let reason = null;
	if (ids.length === 0) reason = "backup.export.reason.no-items";
	else if (linked.failed) reason = "backup.export.reason.linked-failed";
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
		<HookForm methods={methods} onSubmit={onSubmit}>
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
		</HookForm>
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
			{base && !mePending ? (
				<ExportContent kind={kind} base={base} admin={Boolean(isAdmin(me?.roles))} onClose={remove} />
			) : null}
			{!base && error ? (
				<>
					<ExportHeader kind={kind} />
					<AppModal.Body>
						<ErrorAlert error={error} className="mb-0" />
					</AppModal.Body>
					<AppModal.Footer>
						<Button variant="ghost" onClick={remove}>
							<T id="action.close" />
						</Button>
					</AppModal.Footer>
				</>
			) : null}
			{!error && (isPending || mePending) ? (
				<>
					<ExportHeader kind={kind} />
					<AppModal.Body>
						<Loading noLogo />
					</AppModal.Body>
				</>
			) : null}
		</AppModal>
	);
});

export { showExportItemsModal };
