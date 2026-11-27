import { normalizePublicUrl } from "./NotificationForms.js";

/**
 * The pure parts of the invitations in the Users list and the user window, and of the reset page's wording
 */

/**
 * Whether invitations are offered: mail configured, the switch on and a valid public URL (what the backend checks
 * before it sends one). false while a setting is not loaded.
 *
 * @param   {Object|undefined}  email          GET /settings/email (camelized)
 * @param   {Object|undefined}  notifications  GET /settings/notifications (camelized)
 * @returns {boolean}
 */
export const invitationsOffered = (email, notifications) =>
	email?.configured === true &&
	email.invitations === true &&
	normalizePublicUrl(String(notifications?.publicUrl ?? "").trim()) !== null;

/**
 * The invite option of the new user window: only for an administrator, only for a new user, only while invitations
 * are offered
 *
 * @param   {{ offered: boolean, isAdmin: boolean, isNew: boolean }}  state
 * @returns {boolean}
 */
export const inviteOptionShown = ({ offered, isAdmin, isNew }) => offered && isAdmin && isNew;

/**
 * "Send invitation again" in a row menu: an invited user, while invitations are offered
 *
 * @param   {Object}   user     a users list item
 * @param   {boolean}  offered  invitationsOffered()
 * @returns {boolean}
 */
export const resendShown = (user, offered) => offered && user?.invited === true;

/**
 * The request body of a new user: the invite flag only when the option is shown and ticked
 *
 * @param   {Object}   payload  the form values
 * @param   {boolean}  shown    inviteOptionShown()
 * @returns {Object}
 */
export const userCreatePayload = (payload, shown) => {
	const { invite, ...rest } = payload;
	return shown && invite === true ? { ...rest, invite: true } : rest;
};

/**
 * What the answer of an invitation says (create with invite, or resend)
 *
 * @param   {{ invitation?: { sent?: boolean, error?: string, errorI18n?: string, errorValues?: Object } }|undefined}  result
 * @returns {{ sent: true }|{ sent: false, error: string, i18n: string|undefined, values: Object|undefined }|null}
 *   null when the answer carries no invitation
 */
export const invitationOutcome = (result) => {
	const invitation = result?.invitation;
	if (!invitation) return null;
	if (invitation.sent === true) return { sent: true };
	return {
		sent: false,
		error: invitation.error ?? "",
		i18n: invitation.errorI18n,
		values: invitation.errorValues,
	};
};

/**
 * The wording of the reset page by the purpose of its link ("invite", else a reset): the title and the button
 *
 * @param   {string|null|undefined}  purpose
 * @returns {{ title: string, button: string }}  translation ids
 */
export const resetWording = (purpose) =>
	purpose === "invite"
		? { title: "reset-password.invite.title", button: "reset-password.invite.button" }
		: { title: "reset-password.title", button: "save" };
