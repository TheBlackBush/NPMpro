import { useFormikContext } from "formik";
import { SwitchField } from "src/components";
import { T } from "src/locale";
import { LockedBadge } from "./LockedBadge";

function SignInRules({ data, isLocked }) {
	const { values, setFieldValue } = useFormikContext();
	// Turning password login off from a password session is refused by the backend; an already-on value may stay
	const passwordLockedOut = data.sessionAuthMethod !== "oidc" && !data.disablePassword;

	const disablePasswordHint = isLocked("disablePassword")
		? "settings.authentication.disable-password.env-locked"
		: passwordLockedOut
			? "settings.authentication.disable-password.locked"
			: "settings.authentication.disable-password.hint";

	const rule = (name, labelId, hintId, extra = {}) => (
		<SwitchField
			className="py-3"
			id={`oidc-${name}`}
			label={
				<>
					<T id={labelId} />
					{isLocked(name) ? <LockedBadge /> : null}
				</>
			}
			hint={hintId ? <T id={hintId} /> : null}
			disabled={isLocked(name) || extra.disabled}
			checked={Boolean(values[name])}
			onChange={(e) => setFieldValue(name, e.target.checked)}
		/>
	);

	return (
		<div className="mb-4">
			<h4 className="mb-3">
				<T id="settings.authentication.rules" />
			</h4>
			<div className="divide-y">
				{rule(
					"requireVerifiedEmail",
					"settings.authentication.require-verified-email",
					"settings.authentication.require-verified-email.hint",
				)}
				{rule("skipMfa", "settings.authentication.skip-mfa", "settings.authentication.skip-mfa.hint")}
				{rule("disablePassword", "settings.authentication.disable-password", disablePasswordHint, {
					disabled: passwordLockedOut,
				})}
			</div>
		</div>
	);
}

export { SignInRules };
