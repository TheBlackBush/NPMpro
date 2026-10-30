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
		<>
			<SwitchField
				{...register("secrets", {
					onChange: (event) => {
						if (!event.target.checked) clearErrors(PASSPHRASE_FIELDS);
					},
				})}
				id={`${baseId}-secrets`}
				className="mt-2 mb-3"
				label={<T id="settings.backup.secrets" />}
				hint={<T id="settings.backup.secrets.hint" />}
				disabled={disabled}
			/>
			{secretsOn ? (
				<div className="row">
					<div className="col-12 col-md-6">
						<div className="mb-3">
							<PasswordInput
								{...register("passphrase", { onChange: recheckRepeat })}
								id={`${baseId}-passphrase`}
								label={<T id="settings.backup.passphrase" />}
								autoComplete="new-password"
								error={errors.passphrase?.message}
							/>
							{passphraseHintId ? (
								<div className="form-hint">
									<T id={passphraseHintId} />
								</div>
							) : null}
						</div>
					</div>
					<div className="col-12 col-md-6">
						<div className="mb-3">
							<PasswordInput
								{...register("passphraseRepeat")}
								id={`${baseId}-passphrase-repeat`}
								label={<T id="settings.backup.passphrase.repeat" />}
								autoComplete="new-password"
								error={errors.passphraseRepeat?.message}
							/>
						</div>
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

export { PASSPHRASE_FIELDS, SecretsFields, validateSecrets };
