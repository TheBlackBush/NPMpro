import { Lock, LogIn, MonitorOff, ShieldOff, Unlink } from "lucide-react";
import { useEffect, useRef } from "react";
import { ErrorAlert, Loading } from "src/components";
import { SettingLine, SettingLines } from "src/components/Form";
import { Button as UiButton } from "src/components/ui/button";
import { useUser, useUsersMfa } from "src/hooks";
import { T } from "src/locale";
import { showUserSignInAction } from "src/modals/UserSignInActions";
import { isOwnUser, signInActions } from "src/modules/AccountWindow";
import { AccountPart } from "./AccountPart";

// each action's line: its button text (the Users row menu's), its hint and icon
const LINES = {
	"set-password": { labelId: "user.set-password", hintId: "account.sign-in.set-password", icon: Lock },
	"reset-mfa": { labelId: "user.reset-mfa", hintId: "account.sign-in.reset-mfa", icon: ShieldOff },
	"revoke-sessions": { labelId: "user.revoke-sessions", hintId: "account.sign-in.revoke-sessions", icon: MonitorOff },
	"unlink-oidc": { labelId: "user.unlink-oidc", hintId: "account.sign-in.unlink-oidc", icon: Unlink },
};

// Another user's sign-in, for an administrator: the actions of the Users row menu as lines, each opening its window
// on top of this one. Nothing here is a form: the part never has unsaved changes.
export function SignInPart({ userId }) {
	const { data: user, isPending, error } = useUser(userId);
	const { data: me, isPending: mePending } = useUser("me");
	const mfaIds = useUsersMfa(user ? [user] : [], me?.id);
	const heading = useRef(null);
	// no line until /users/me is known: the own account (or one not known yet) has none
	const actions = user
		? signInActions({
				isSelf: isOwnUser(user.id, me?.id) !== false,
				hasMfa: mfaIds.has(user.id),
				oidcLinked: Boolean(user.npmproOidcLinkedOn),
			})
		: [];
	// a line that went away after its action (Reset MFA, Unlink OIDC) held the focus: the heading takes it
	const shown = actions.join();
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the shown lines change
	useEffect(() => {
		const active = document.activeElement;
		if (!active || active === document.body) heading.current?.focus({ preventScroll: true });
	}, [shown]);
	return (
		<AccountPart id="sign-in" icon={LogIn} heading={<T id="account.sign-in" />} headingRef={heading}>
			{error ? <ErrorAlert error={error} /> : null}
			{isPending || mePending ? <Loading noLogo /> : null}
			{user ? (
				<SettingLines>
					{actions.map((action) => {
						const { labelId, hintId, icon: Icon } = LINES[action];
						return (
							<SettingLine
								key={action}
								id={`sign-in-${action}`}
								title={<T id={labelId} />}
								hint={<T id={hintId} />}
								control={
									<UiButton
										type="button"
										variant={action === "set-password" ? "outline" : "destructive-outline"}
										size="sm"
										onClick={() => showUserSignInAction(action, user)}
										data-sign-in-action={action}
									>
										<Icon data-icon="inline-start" aria-hidden="true" />
										<T id={labelId} />
									</UiButton>
								}
							/>
						);
					})}
				</SettingLines>
			) : null}
		</AccountPart>
	);
}
