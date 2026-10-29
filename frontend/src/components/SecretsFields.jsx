import { Field, useFormikContext } from "formik";
import { useId } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
import { passphraseErrors } from "src/modules/BackupTypes";
import { PasswordInput, SwitchField, useRecheckDependent } from "./Form";

// the passphrase fields, whose messages go when secrets are off
const PASSPHRASE_FIELDS = ["passphrase", "passphraseRepeat"];

/**
 * The validate of the secrets fields (secrets, passphrase, passphraseRepeat): the messages of passphraseErrors
 */
const validateSecrets = (values) =>
	Object.fromEntries(
		Object.entries(passphraseErrors(values)).map(([field, id]) => [field, intl.formatMessage({ id })]),
	);

function PassphraseInput({ id, labelId, hintId, error, inputProps }) {
	return (
		<div className="mb-3">
			<PasswordInput
				{...inputProps}
				id={id}
				label={<T id={labelId} />}
				autoComplete="new-password"
				error={error}
			/>
			{hintId ? (
				<div className="form-hint">
					<T id={hintId} />
				</div>
			) : null}
		</div>
	);
}

// the switch and, while it is on, the passphrase twice; else the note
function SecretsLayout({ baseId, offNoteId, passphraseHintId, disabled, secretsOn, switchProps, passphrase }) {
	return (
		<>
			<SwitchField
				{...switchProps}
				id={`${baseId}-secrets`}
				className="mt-2 mb-3"
				label={<T id="settings.backup.secrets" />}
				hint={<T id="settings.backup.secrets.hint" />}
				disabled={disabled}
			/>
			{secretsOn ? (
				<div className="row">
					<div className="col-12 col-md-6">
						{passphrase(
							"passphrase",
							`${baseId}-passphrase`,
							"settings.backup.passphrase",
							passphraseHintId,
						)}
					</div>
					<div className="col-12 col-md-6">
						{passphrase(
							"passphraseRepeat",
							`${baseId}-passphrase-repeat`,
							"settings.backup.passphrase.repeat",
						)}
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

// in a Formik form: shown once left or after a submit
function FormikSecretsFields(props) {
	const { values, submitCount } = useFormikContext();
	return (
		<Field name="secrets" type="checkbox">
			{({ field }) => (
				<SecretsLayout
					{...props}
					secretsOn={values.secrets}
					switchProps={field}
					passphrase={(name, id, labelId, hintId) => (
						<Field name={name}>
							{({ field: input, meta }) => (
								<PassphraseInput
									id={id}
									labelId={labelId}
									hintId={hintId}
									inputProps={input}
									error={meta.touched || submitCount > 0 ? meta.error : undefined}
								/>
							)}
						</Field>
					)}
				/>
			)}
		</Field>
	);
}

// in a React Hook Form form: turning secrets off drops the passphrase messages; a new passphrase re-checks the repeat
function HookFormSecretsFields(props) {
	const { register, clearErrors } = useFormContext();
	const recheckRepeat = useRecheckDependent("passphraseRepeat");
	const { errors } = useFormState();
	const secretsOn = useWatch({ name: "secrets" });
	return (
		<SecretsLayout
			{...props}
			secretsOn={secretsOn}
			switchProps={register("secrets", {
				onChange: (event) => {
					if (!event.target.checked) clearErrors(PASSPHRASE_FIELDS);
				},
			})}
			passphrase={(name, id, labelId, hintId) => (
				<PassphraseInput
					id={id}
					labelId={labelId}
					hintId={hintId}
					inputProps={register(name, name === "passphrase" ? { onChange: recheckRepeat } : undefined)}
					error={errors[name]?.message}
				/>
			)}
		/>
	);
}

/**
 * "Include secrets" as a switch and, while it is on, the passphrase twice (the fields secrets, passphrase and
 * passphraseRepeat of a React Hook Form or a Formik form); while it is off a note on what is left out.
 *
 * @param {Object}  props
 * @param {string}  props.offNoteId           the translation of the note shown without secrets
 * @param {string}  [props.passphraseHintId]  the translation of the hint under the passphrase
 * @param {boolean} [props.disabled]
 */
function SecretsFields({ offNoteId, passphraseHintId = "settings.backup.passphrase.hint", disabled = false }) {
	const baseId = useId();
	const props = { baseId, offNoteId, passphraseHintId, disabled };
	// A3 removes the Formik branch
	return useFormContext() ? <HookFormSecretsFields {...props} /> : <FormikSecretsFields {...props} />;
}

export { PASSPHRASE_FIELDS, SecretsFields, validateSecrets };
