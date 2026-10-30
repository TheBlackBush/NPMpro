import { useEffect, useId, useRef, useState } from "react";
import { useController, useFormContext, useFormState } from "react-hook-form";
import { downloadPendingBackup } from "src/api/backend";
import {
	Button,
	ErrorAlert,
	FormErrorNote,
	focusFirstError,
	HookForm,
	Loading,
	SecretsFields,
	TypeTree,
	useAppForm,
	useFieldOrder,
	useResetToSaved,
	validateSecrets,
} from "src/components";
import { useBackupTypes, useCreateBackup } from "src/hooks";
import { T } from "src/locale";
import { DEFAULT_SELECTED, withErrorDetails } from "src/modules/BackupTypes";
import { errorPaths } from "src/modules/HookForm";
import { showObjectSuccess } from "src/notifications";

function CreateForm({ data, error, keepRef }) {
	const { setFocus } = useFormContext();
	const { isSubmitting, errors } = useFormState();
	// the parts to include: never a message of their own (no types only disables the buttons), so no ref to focus
	const { field: types } = useController({ name: "types" });
	const order = useFieldOrder();
	const baseId = useId();
	const noteId = `${baseId}-note`;
	const reasonId = `${baseId}-reason`;
	const blocked = errorPaths(errors).length > 0;
	const noTypes = types.value.length === 0;
	const showReason = noTypes && !blocked && !isSubmitting;
	const describedBy = blocked ? noteId : showReason ? reasonId : undefined;
	// which button started the save, for its spinner: "Keep on server" submits the form itself, Download (and Enter
	// in a field) is the submit button
	const [keepRunning, setKeepRunning] = useState(false);
	useEffect(() => {
		if (!isSubmitting) setKeepRunning(false);
	}, [isSubmitting]);
	const onBlocked = (e) => focusFirstError(e.currentTarget.closest("form"), errors, order, setFocus);

	const keepOnServer = (e) => {
		keepRef.current = true;
		setKeepRunning(true);
		e.currentTarget.form?.requestSubmit();
	};

	return (
		<>
			<div className="card-header">
				<h3 className="card-title">
					<T id="settings.backup.create" />
				</h3>
			</div>
			<div className="card-body">
				<TypeTree
					label={<T id="settings.backup.create.parts" />}
					categories={data.categories}
					counts={data.counts}
					certificateKinds={data.certificateKinds}
					selected={types.value}
					onChange={types.onChange}
					disabled={isSubmitting}
				/>
				<SecretsFields offNoteId="settings.backup.secrets.off" disabled={isSubmitting} />
				<ErrorAlert error={error} className="mb-0" />
			</div>
			<div className="card-footer d-flex flex-wrap align-items-center justify-content-end gap-2">
				<FormErrorNote id={noteId} className="me-2 text-end" />
				{showReason ? (
					<span id={reasonId} className="text-secondary small me-2 text-end">
						<T id="settings.backup.reason.no-types" />
					</span>
				) : null}
				<Button
					isLoading={isSubmitting && keepRunning}
					disabled={(isSubmitting && !keepRunning) || (noTypes && !blocked)}
					blocked={blocked}
					onBlockedClick={onBlocked}
					onMouseDown={(e) => e.preventDefault()}
					onClick={keepOnServer}
					aria-describedby={describedBy}
				>
					<T id="settings.backup.keep" />
				</Button>
				<Button
					type="submit"
					color="teal"
					isLoading={isSubmitting && !keepRunning}
					disabled={(isSubmitting && keepRunning) || (noTypes && !blocked)}
					blocked={blocked}
					onBlockedClick={onBlocked}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => {
						keepRef.current = false;
						setKeepRunning(false);
					}}
					aria-describedby={describedBy}
				>
					<T id="action.download" />
				</Button>
			</div>
		</>
	);
}

// the form of the loaded backup types: the default parts chosen, secrets on
function CreateBackupForm({ data }) {
	const createBackup = useCreateBackup();
	const [error, setError] = useState(null);
	// which button submitted: the submit button (Enter in a field too) downloads, "Keep on server" sets it first
	const keepRef = useRef(false);
	const [defaultValues] = useState(() => ({
		types: DEFAULT_SELECTED(data.categories),
		secrets: true,
		passphrase: "",
		passphraseRepeat: "",
	}));
	const methods = useAppForm({ defaultValues, validate: validateSecrets });
	const resetToSaved = useResetToSaved(methods);

	const onSubmit = async (values) => {
		const keep = keepRef.current;
		keepRef.current = false;
		if (values.types.length === 0) return;
		setError(null);
		try {
			const result = await createBackup.mutateAsync({
				types: values.types,
				secrets: values.secrets,
				passphrase: values.secrets ? values.passphrase : undefined,
				keep,
			});
			if (keep) {
				showObjectSuccess("backup", "saved");
			} else {
				await downloadPendingBackup(result.pending, result.name);
			}
			// the passphrase is not kept around once it was used; the rest is the new starting point
			methods.setValue("passphrase", "");
			methods.setValue("passphraseRepeat", "");
			resetToSaved();
		} catch (err) {
			setError(withErrorDetails(err));
		}
	};

	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="card mb-4">
			<CreateForm data={data} error={error} keepRef={keepRef} />
		</HookForm>
	);
}

/**
 * Create a backup: the parts to include, secrets with a passphrase or none, then download it at once or keep it on
 * the server (it then shows in the stored backups).
 */
function CreateCard() {
	const { data, isPending, error: loadError } = useBackupTypes();

	if (isPending) return <Loading noLogo />;
	if (loadError) return <ErrorAlert error={loadError} />;

	return <CreateBackupForm data={data} />;
}

export { CreateCard };
