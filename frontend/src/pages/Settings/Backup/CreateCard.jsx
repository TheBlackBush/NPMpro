import { Form, Formik, useFormikContext } from "formik";
import { useId, useRef, useState } from "react";
import { downloadPendingBackup } from "src/api/backend";
import {
	Button,
	ErrorAlert,
	FormErrorNote,
	Loading,
	SecretsFields,
	showFirstInvalid,
	useShownErrors,
	validateSecrets,
} from "src/components";
import { useBackupTypes, useCreateBackup } from "src/hooks";
import { T } from "src/locale";
import { DEFAULT_SELECTED, withErrorDetails } from "src/modules/BackupTypes";
import { showObjectSuccess } from "src/notifications";
import { TypeTree } from "./TypeTree";

function CreateForm({ data, error, keepRef }) {
	const { values, setFieldValue, isSubmitting, submitForm } = useFormikContext();
	const baseId = useId();
	const noteId = `${baseId}-note`;
	const reasonId = `${baseId}-reason`;
	const blocked = useShownErrors(true).length > 0;
	const noTypes = values.types.length === 0;
	const showReason = noTypes && !blocked && !isSubmitting;
	const describedBy = blocked ? noteId : showReason ? reasonId : undefined;
	const [keepRunning, setKeepRunning] = useState(false);

	const keepOnServer = () => {
		keepRef.current = true;
		setKeepRunning(true);
		void submitForm().finally(() => setKeepRunning(false));
	};

	return (
		<Form className="card mb-4" noValidate>
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
					selected={values.types}
					onChange={(types) => setFieldValue("types", types)}
					disabled={isSubmitting}
				/>
				<SecretsFields offNoteId="settings.backup.secrets.off" disabled={isSubmitting} />
				<ErrorAlert error={error} className="mb-0" />
			</div>
			<div className="card-footer d-flex flex-wrap align-items-center justify-content-end gap-2">
				<FormErrorNote id={noteId} late className="me-2 text-end" />
				{showReason ? (
					<span id={reasonId} className="text-secondary small me-2 text-end">
						<T id="settings.backup.reason.no-types" />
					</span>
				) : null}
				<Button
					isLoading={isSubmitting && keepRunning}
					disabled={(isSubmitting && !keepRunning) || (noTypes && !blocked)}
					blocked={blocked}
					onBlockedClick={(e) => showFirstInvalid(e.currentTarget.closest("form"))}
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
					onBlockedClick={(e) => showFirstInvalid(e.currentTarget.closest("form"))}
					onMouseDown={(e) => e.preventDefault()}
					onClick={() => {
						keepRef.current = false;
					}}
					aria-describedby={describedBy}
				>
					<T id="action.download" />
				</Button>
			</div>
		</Form>
	);
}

/**
 * Create a backup: the parts to include, secrets with a passphrase or none, then download it at once or keep it on
 * the server (it then shows in the stored backups).
 */
function CreateCard() {
	const { data, isPending, error: loadError } = useBackupTypes();
	const createBackup = useCreateBackup();
	const [error, setError] = useState(null);
	// which button submitted: the submit button (Enter in a field too) downloads, "Keep on server" sets it first
	const keepRef = useRef(false);

	if (isPending) return <Loading noLogo />;
	if (loadError) return <ErrorAlert error={loadError} />;

	const onSubmit = async (values, { resetForm }) => {
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
			// the passphrase is not kept around once it was used
			resetForm({ values: { ...values, passphrase: "", passphraseRepeat: "" } });
		} catch (err) {
			setError(withErrorDetails(err));
		}
	};

	return (
		<Formik
			initialValues={{
				types: DEFAULT_SELECTED(data.categories),
				secrets: true,
				passphrase: "",
				passphraseRepeat: "",
			}}
			validate={validateSecrets}
			onSubmit={onSubmit}
		>
			<CreateForm data={data} error={error} keepRef={keepRef} />
		</Formik>
	);
}

export { CreateCard };
