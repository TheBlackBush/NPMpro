import { useId } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { intl, T } from "src/locale";
import { passphraseErrors } from "src/modules/BackupTypes";
import { translateErrors } from "src/modules/HookForm";
import { PasswordInput, SwitchField, useRecheckDependent } from "./Form";

// the passphrase fields, whose messages go when secrets are off
const PASSPHRASE_FIELDS = ["passphrase", "passphraseRepeat"];

/**
 * The validate of the secrets fields (secrets, passphrase, passphraseRepeat): the messages of passphraseErrors
 */
const validateSecrets = (values) => translateErrors(passphraseErrors(values), intl);

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

/**
 * "Include secrets" as a switch and, while it is on, the passphrase twice (the fields secrets, passphrase and
 * passphraseRepeat of the form around it); while it is off a note on what is left out. Turning secrets off drops the
 * passphrase messages; a new passphrase checks the repeat again.
 *
 * @param {Object}  props
 * @param {string}  props.offNoteId           the translation of the note shown without secrets
 * @param {string}  [props.passphraseHintId]  the translation of the hint under the passphrase
 * @param {boolean} [props.disabled]
 */
function SecretsFields({ offNoteId, passphraseHintId = "settings.backup.passphrase.hint", disabled = false }) {
	const baseId = useId();
	const { register, clearErrors } = useFormContext();
	const recheckRepeat = useRecheckDependent("passphraseRepeat");
	const { errors } = useFormState();
	const secretsOn = useWatch({ name: "secrets" });
	return (
		<SecretsLayout
			baseId={baseId}
			offNoteId={offNoteId}
			passphraseHintId={passphraseHintId}
			disabled={disabled}
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

export { PASSPHRASE_FIELDS, SecretsFields, validateSecrets };
