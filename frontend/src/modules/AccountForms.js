/**
 * The validate functions of the account windows (change password, set password, two-factor codes, user), built from
 * the field rules each Formik field had, for React Hook Form's resolver
 */
import { fieldsValidate } from "./HookForm.js";

const SIX_DIGITS = /^\d{6}$/u;

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
 * The code of a two-factor step: six digits to turn it on or to make new backup codes ("setup", "verify"); to turn
 * it off a code or a backup code of 6 to 8 characters ("disable")
 *
 * @param   {Object} rules
 * @param   {"setup"|"verify"|"disable"} step
 * @returns {Function}
 */
export const mfaCodeValidate = (rules, step) =>
	fieldsValidate({
		code:
			step === "disable"
				? rules.validateString(6, 8)
				: rules.validateText({ required: true, pattern: SIX_DIGITS, messageId: "error.code-six-digits" }),
	});

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
