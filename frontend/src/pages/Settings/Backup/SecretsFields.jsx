import { Field, useFormikContext } from "formik";
import { useId } from "react";
import { PasswordInput, SwitchField } from "src/components";
import { intl, T } from "src/locale";
import { passphraseErrors } from "src/modules/BackupTypes";

/**
 * Formik validate of the secrets fields (secrets, passphrase, passphraseRepeat): the messages of passphraseErrors
 */
const validateSecrets = (values) =>
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

/**
 * "Include secrets" as a switch and, while it is on, the passphrase twice (Formik fields secrets, passphrase and
 * passphraseRepeat); while it is off a note on what is left out.
 *
 * @param {Object}  props
 * @param {string}  props.offNoteId  the translation of the note shown without secrets
 * @param {boolean} [props.disabled]
 */
function SecretsFields({ offNoteId, disabled = false }) {
	const { values } = useFormikContext();
	const baseId = useId();
	return (
		<>
			<Field name="secrets" type="checkbox">
				{({ field }) => (
					<SwitchField
						{...field}
						id={`${baseId}-secrets`}
						className="mt-2 mb-3"
						label={<T id="settings.backup.secrets" />}
						hint={<T id="settings.backup.secrets.hint" />}
						disabled={disabled}
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
					<T id={offNoteId} />
				</p>
			)}
		</>
	);
}

export { SecretsFields, validateSecrets };
