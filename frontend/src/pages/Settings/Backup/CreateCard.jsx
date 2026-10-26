import { Field, Form, Formik, useFormikContext } from "formik";
import { useId, useRef, useState } from "react";
import { downloadPendingBackup } from "src/api/backend";
import {
	Button,
	ErrorAlert,
	FormErrorNote,
	Loading,
	PasswordInput,
	SwitchField,
	showFirstInvalid,
	useShownErrors,
} from "src/components";
import { useBackupTypes, useCreateBackup } from "src/hooks";
import { intl, T } from "src/locale";
import { DEFAULT_SELECTED, passphraseErrors, withErrorDetails } from "src/modules/BackupTypes";
import { showObjectSuccess } from "src/notifications";
import { TypeTree } from "./TypeTree";

const validate = (values) =>
	Object.fromEntries(
		Object.entries(passphraseErrors(values)).map(([field, id]) => [field, intl.formatMessage({ id })]),
	);

function PassphraseField({ name, id, labelId, hintId }) {
	const { submitCount } = useFormikContext();
	return (
		<Field name={name}>
			{({ field, meta }) => (
				<div className="mb-3">
					<PasswordInput
						{...field}
						id={id}
						label={<T id={labelId} />}
						autoComplete="new-password"
						error={meta.touched || submitCount > 0 ? meta.error : undefined}
					/>
					{hintId ? (
						<div className="form-hint">
							<T id={hintId} />
						</div>
					) : null}
				</div>
			)}
		</Field>
	);
}

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
				<div className="form-label">
					<T id="settings.backup.create.parts" />
				</div>
				<TypeTree
					categories={data.categories}
					counts={data.counts}
					certificateKinds={data.certificateKinds}
					selected={values.types}
					onChange={(types) => setFieldValue("types", types)}
					disabled={isSubmitting}
				/>
				<Field name="secrets" type="checkbox">
					{({ field }) => (
						<SwitchField
							{...field}
							id={`${baseId}-secrets`}
							className="mt-2 mb-3"
							label={<T id="settings.backup.secrets" />}
							hint={<T id="settings.backup.secrets.hint" />}
							disabled={isSubmitting}
						/>
					)}
				</Field>
				{values.secrets ? (
					<div className="row">
						<div className="col-12 col-md-6">
							<PassphraseField
								name="passphrase"
								id={`${baseId}-passphrase`}
								labelId="settings.backup.passphrase"
								hintId="settings.backup.passphrase.hint"
							/>
						</div>
						<div className="col-12 col-md-6">
							<PassphraseField
								name="passphraseRepeat"
								id={`${baseId}-passphrase-repeat`}
								labelId="settings.backup.passphrase.repeat"
							/>
						</div>
					</div>
				) : (
					<p className="text-secondary small mb-3">
						<T id="settings.backup.secrets.off" />
					</p>
				)}
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
			validate={validate}
			onSubmit={onSubmit}
		>
			<CreateForm data={data} error={error} keepRef={keepRef} />
		</Formik>
	);
}

export { CreateCard };
