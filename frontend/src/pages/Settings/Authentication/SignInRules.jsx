import { useFormContext, useFormState } from "react-hook-form";
import { SwitchField, SwitchList } from "src/components";
import { T } from "src/locale";
import { LockedBadge } from "./LockedBadge";

function SignInRules({ data, isLocked }) {
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
			label={<T id={labelId} />}
			badges={isLocked(name) ? <LockedBadge /> : null}
			hint={hintId ? <T id={hintId} /> : null}
			disabled={isLocked(name) || extra.disabled}
			error={errors[name]?.message}
		/>
	);

	return (
		<SwitchList>
			{rule(
				"requireVerifiedEmail",
				"settings.authentication.require-verified-email",
				"settings.authentication.require-verified-email.hint",
			)}
			{rule("skipMfa", "settings.authentication.skip-mfa", "settings.authentication.skip-mfa.hint")}
			{rule("disablePassword", "settings.authentication.disable-password", disablePasswordHint, {
				disabled: passwordLockedOut,
			})}
		</SwitchList>
	);
}

export { SignInRules };
