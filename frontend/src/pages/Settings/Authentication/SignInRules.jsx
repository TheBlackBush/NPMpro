import { useFormContext, useFormState } from "react-hook-form";
import { Link } from "react-router";
import { SwitchField } from "src/components";
import { T } from "src/locale";
import { passwordResetState } from "src/modules/AuthenticationForms";
import { LockedBadge } from "./LockedBadge";

function SignInRules({ data, isLocked, email, notifications }) {
	const { register, trigger } = useFormContext();
	const { errors } = useFormState({ name: "disablePassword", exact: true });
	// Turning password login off from a password session is refused by the backend; an already-on value may stay
	const passwordLockedOut = data.sessionAuthMethod !== "oidc" && !data.disablePassword;

	const disablePasswordHint = isLocked("disablePassword")
		? "settings.authentication.disable-password.env-locked"
		: passwordLockedOut
			? "settings.authentication.disable-password.locked"
			: "settings.authentication.disable-password.hint";

	// "Disable password login" has a rule of its own: its message shows as soon as it is switched
	const rule = (name, labelId, hintId, extra = {}) => (
		<SwitchField
			{...register(name, name === "disablePassword" ? { onChange: () => void trigger(name) } : undefined)}
			id={`oidc-${name}`}
			line
			label={<T id={labelId} />}
			badges={isLocked(name) ? <LockedBadge env={data.lockedBy?.[name]} /> : null}
			hint={hintId ? <T id={hintId} /> : null}
			disabled={isLocked(name) || extra.disabled}
			error={errors[name]?.message}
		/>
	);

	const reset = passwordResetState(email, notifications);

	return (
		<>
			{rule(
				"requireVerifiedEmail",
				"settings.authentication.require-verified-email",
				"settings.authentication.require-verified-email.hint",
			)}
			{rule("skipMfa", "settings.authentication.skip-mfa", "settings.authentication.skip-mfa.hint")}
			{rule("disablePassword", "settings.authentication.disable-password", disablePasswordHint, {
				disabled: passwordLockedOut,
			})}
			{reset.shown ? (
				<SwitchField
					{...register("allowPasswordReset")}
					id="oidc-allowPasswordReset"
					line
					label={<T id="settings.authentication.allow-password-reset" />}
					badges={
						reset.locked ? (
							<LockedBadge env={email.lockedBy?.allowPasswordReset ?? "PASSWORD_RESET"} />
						) : null
					}
					hint={
						reset.needsUrl ? (
							<>
								<T id="settings.authentication.allow-password-reset.hint" />{" "}
								<Link
									to="/settings/notifications"
									className="text-primary underline underline-offset-4"
								>
									<T id="settings.authentication.allow-password-reset.needs-url" />
								</Link>
							</>
						) : (
							<T id="settings.authentication.allow-password-reset.hint" />
						)
					}
					disabled={reset.locked || reset.needsUrl}
				/>
			) : null}
		</>
	);
}

export { SignInRules };
