/**
 * The text of an invitation mail that could not be sent: the translated reason, and for a new user that the user
 * exists and the invitation can be sent again from the list.
 *
 * @param   {{ error: string, i18n?: string, values?: Object }}  outcome  invitationOutcome() of a failed send
 * @param   {{ created: boolean, format: (id: string, values?: Object) => string, has: (id: string) => boolean }}  options
 * @returns {string}
 */
export const invitationFailureText = (outcome, { created, format, has }) => {
	const reason = outcome.i18n && has(outcome.i18n) ? format(outcome.i18n, outcome.values) : outcome.error;
	return created ? `${reason} ${format("user.invitation.created-not-sent")}` : reason;
};
