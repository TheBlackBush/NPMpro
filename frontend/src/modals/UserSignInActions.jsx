import { adminDisableMfa, revokeSessions, unlinkUserOidc } from "src/api/backend";
import { intl, T } from "src/locale";
import { showObjectSuccess, showSuccess } from "src/notifications";
import { showDeleteConfirmModal } from "./DeleteConfirmModal";
import { showSetPasswordModal } from "./SetPasswordModal";

// a confirm window naming the user, as the Users row menu always showed it
const confirmFor = (user, { titleId, contentId, request, done, invalidations }) =>
	showDeleteConfirmModal({
		tTitle: titleId,
		children: <T id={contentId} />,
		subject: user.name,
		details: user.email,
		onConfirm: async () => {
			await request(user.id);
			done();
		},
		invalidations,
	});

// The administrator's sign-in actions for another user, shared by the Users row menu and the Sign-in part of the
// user's window. Which of them a user offers is signInActions (modules/AccountWindow.js).
const ACTIONS = {
	"set-password": (user) => showSetPasswordModal(user.id),
	"reset-mfa": (user) =>
		confirmFor(user, {
			titleId: "user.reset-mfa",
			contentId: "user.reset-mfa.content",
			request: adminDisableMfa,
			done: () => showObjectSuccess("user", "updated"),
			invalidations: [
				["user", user.id],
				["users-mfa", user.id],
			],
		}),
	"revoke-sessions": (user) =>
		confirmFor(user, {
			titleId: "user.revoke-sessions",
			contentId: "user.revoke-sessions.content",
			request: revokeSessions,
			done: () => showSuccess(intl.formatMessage({ id: "notification.user-sessions-revoked" })),
			invalidations: [["users"], ["user", user.id]],
		}),
	"unlink-oidc": (user) =>
		confirmFor(user, {
			titleId: "user.unlink-oidc",
			contentId: "user.unlink-oidc.content",
			request: unlinkUserOidc,
			done: () => showObjectSuccess("user", "updated"),
			invalidations: [["users"], ["user", user.id]],
		}),
};

/**
 * Opens the window of one sign-in action for a user: Set Password, or the confirm window of Reset MFA, Revoke sessions
 * or Unlink OIDC. Each window gives the focus back to the button that opened it when it closes.
 * Nothing opens without a user (its row went away with a refetch while its menu was open).
 *
 * @param {"set-password"|"reset-mfa"|"revoke-sessions"|"unlink-oidc"} action
 * @param {{ id: number, name: string, email: string }|null|undefined} user
 */
export const showUserSignInAction = (action, user) => {
	if (!user) return;
	ACTIONS[action](user);
};
