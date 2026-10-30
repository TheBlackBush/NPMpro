/**
 * The validate functions of the account windows (change password, set password, two-factor codes, user), built from
 * the field rules each Formik field had, for React Hook Form's resolver
 */
import { fieldsValidate } from "./HookForm.js";

const SIX_DIGITS = /^\d{6}$/u;
// a backup code: 8 of the backend's Crockford Base32 characters (it reads O as 0, I and L as 1)
const BACKUP_CODE = /^[0-9A-Z]{8}$/u;
const BACKUP_SEPARATORS = /[\s-]/gu;

/**
 * The digits of an authenticator app's code (CodeInput's boxes)
 */
export const CODE_LENGTH = 6;

/**
 * The characters of a backup code (CodeInput's boxes)
 */
export const BACKUP_CODE_LENGTH = 8;

/**
 * The starting values of a code form: the app's code, a backup code and which of the two is used
 */
export const CODE_VALUES = Object.freeze({ code: "", backupCode: "", useBackup: false });

/**
 * A backup code as typed (spaces, a dash, small letters) in the form the backend checks
 *
 * @param   {string} text
 * @returns {string}
 */
export const normalizeBackupCode = (text) =>
	String(text ?? "")
		.replace(BACKUP_SEPARATORS, "")
		.toUpperCase();

/**
 * The code a code form sends ({ code }): the app's six digits, or the backup code
 *
 * @param   {{ code: string, backupCode: string, useBackup: boolean }} values
 * @returns {string}
 */
export const codeOf = (values) => (values.useBackup ? normalizeBackupCode(values.backupCode) : values.code);

/**
 * Whether the code shown is complete (sign in waits for it)
 *
 * @param   {{ code: string, backupCode: string, useBackup: boolean }} values
 * @returns {boolean}
 */
export const codeComplete = (values) =>
	values.useBackup ? BACKUP_CODE.test(normalizeBackupCode(values.backupCode)) : SIX_DIGITS.test(values.code);

/**
 * The values "Use a backup code" (true) or "Use the code from the app" (false) sets: the field it shows starts
 * empty, the other one keeps its value
 *
 * @param   {boolean} useBackup
 * @returns {Object}
 */
export const codeModeChanges = (useBackup) =>
	useBackup ? { useBackup: true, backupCode: "" } : { useBackup: false, code: "" };

/**
 * Change password: current 1 to 255 characters, new and repeat 8 to 255, all untrimmed; the repeat must match the
 * new one, and that message wins over the repeat's length message (Formik merged the form's validate last)
 *
 * @param   {Object} rules  createValidations(intl)
 * @returns {Function}
 */
export const changePasswordValidate = (rules) =>
	fieldsValidate(
		{
			current: rules.validateString(1, 255, false),
			new: rules.validateString(8, 255, false),
			confirm: rules.validateString(8, 255, false),
		},
		(values) =>
			values.confirm && values.new !== values.confirm
				? { confirm: rules.message("error.passwords-must-match") }
				: {},
	);

/**
 * Set password (an admin for another user): the new password, 8 to 255 characters, untrimmed
 */
export const setPasswordValidate = (rules) => fieldsValidate({ new: rules.validateString(8, 255, false) });

/**
 * The code of a two-factor step: the app's six digits; turning it off ("disable") also takes a backup code once
 * "Use a backup code" was chosen. Turning it on and making new backup codes ("setup", "verify") take no backup code.
 *
 * @param   {Object} rules
 * @param   {"setup"|"verify"|"disable"} step
 * @returns {Function}
 */
export const mfaCodeValidate = (rules, step) =>
	fieldsValidate((values) =>
		step === "disable" && values.useBackup
			? {
					backupCode: (value) =>
						rules.validateText({ required: true, pattern: BACKUP_CODE, messageId: "error.backup-code" })(
							normalizeBackupCode(value),
						),
				}
			: { code: rules.validateText({ required: true, pattern: SIX_DIGITS, messageId: "error.code-six-digits" }) },
	);

/**
 * The user window: full name 1 to 255 characters (trimmed) and an email address
 */
export const userValidate = (rules) =>
	fieldsValidate({ name: rules.validateString(1, 255), email: rules.validateEmail() });

/**
 * Setup, the first user: full name 1 to 255 characters (trimmed), an email address and a password of 8 to 255
 * characters (untrimmed)
 */
export const setupValidate = (rules) =>
	fieldsValidate({
		name: rules.validateString(1, 255),
		email: rules.validateEmail(),
		password: rules.validateString(8, 255, false),
	});
