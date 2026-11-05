import { useEffect, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import { Button, ErrorAlert, HookForm, OidcButton, useAppForm } from "src/components";
import { CodeEntry, PasswordInput, useRefusedCodeReset } from "src/components/Form";
import { FieldMessage } from "src/components/Form/FieldMessage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "src/components/ui/card";
import { Field, FieldLabel, FieldSeparator } from "src/components/ui/field";
import { Input } from "src/components/ui/input";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { CODE_VALUES, codeComplete, codeOf } from "src/modules/AccountForms";
import { deleteCookie, getCookie } from "src/modules/Cookies";
import { oidcErrorKey, takeOidcError } from "src/modules/Oidc";
import { validateEmail } from "src/modules/Validations";
import { AuthLayout } from "src/shell/AuthLayout";

// Sign in is enabled only for a valid email address and a password
const checkEmail = validateEmail();

// the invalid-address hint once the field was left with something typed in it (an empty field shows nothing)
const emailHint = (value, touched) => (touched && value.trim() !== "" ? (checkEmail(value.trim()) ?? null) : null);

const CODE_FIELDS = ["code", "backupCode", "useBackup"];

/**
 * The title, the line that says which code to enter (the app's, or one of the backup codes), the refusal, the code
 * (the six boxes, or a backup code) and the buttons; Verify waits for a complete code. A refused code
 * empties its field and puts the focus back in it.
 */
function TotpCodeForm({ onSubmit, error }) {
	const { cancelTotp } = useAuthState();
	const methods = useAppForm({ defaultValues: CODE_VALUES, keepEdits: false });
	const { isSubmitting } = methods.formState;
	const { setFocus } = methods;
	const refuse = useRefusedCodeReset(methods);
	const [code, backupCode, useBackup] = useWatch({ control: methods.control, name: CODE_FIELDS });
	useEffect(() => {
		setFocus("code");
	}, [setFocus]);
	const submit = async (values) => {
		if (await onSubmit({ code: codeOf(values) })) return;
		refuse(values.useBackup);
	};
	return (
		<HookForm methods={methods} onSubmit={submit} className="contents">
			<CardHeader className="text-center">
				<CardTitle role="heading" aria-level={1} className="text-xl">
					<T id="login.totp-title" />
				</CardTitle>
				<CardDescription>
					<T id={useBackup ? "login.totp-backup-description" : "login.totp-description"} />
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{error && <ErrorAlert error={error} />}
				<CodeEntry idPrefix="login-totp" label={<T id="login.totp-code" />} allowBackup />
				<div className="grid grid-cols-2 items-start gap-2">
					<Button type="button" fullWidth size="lg" onClick={cancelTotp} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<Button
						type="submit"
						fullWidth
						color="primary"
						size="lg"
						isLoading={isSubmitting}
						disabled={isSubmitting || !codeComplete({ code, backupCode, useBackup })}
					>
						<T id="login.totp-verify" />
					</Button>
				</div>
			</CardContent>
		</HookForm>
	);
}

function TotpForm() {
	const [formErr, setFormErr] = useState(null);
	const { submitTotp } = useAuthState();

	// true when signed in; a refused code shows why and the form empties the field
	const onSubmit = async (payload) => {
		setFormErr(null);
		try {
			await submitTotp(payload);
			return true;
		} catch (err) {
			setFormErr(err);
			return false;
		}
	};

	return <TotpCodeForm onSubmit={onSubmit} error={formErr} />;
}

const redirectToOIDC = () => {
	window.location.href = "/api/oidc";
};

/**
 * Email and password; Sign in waits for a valid address and a password. emailRef gets the email input, for the focus.
 */
function PasswordFields({ emailRef, onSubmit }) {
	const methods = useAppForm({ defaultValues: { email: "", password: "" } });
	const { register } = methods;
	const { isSubmitting, touchedFields } = methods.formState;
	const [email, password] = useWatch({ control: methods.control, name: ["email", "password"] });
	const hint = emailHint(email, Boolean(touchedFields.email));
	const { ref: emailFieldRef, ...emailField } = register("email");
	return (
		<HookForm methods={methods} onSubmit={onSubmit}>
			<div className="flex flex-col gap-4">
				<Field data-invalid={hint ? true : undefined}>
					<FieldLabel htmlFor="login-email">
						<T id="email-address" />
					</FieldLabel>
					<Input
						{...emailField}
						ref={(input) => {
							emailFieldRef(input);
							emailRef.current = input;
						}}
						id="login-email"
						type="email"
						autoComplete="username"
						required
						aria-invalid={hint ? "true" : undefined}
						aria-describedby={hint ? "login-email-error" : undefined}
						placeholder={intl.formatMessage({ id: "email-address" })}
					/>
					{hint ? <FieldMessage id="login-email-error">{hint}</FieldMessage> : null}
				</Field>
				<PasswordInput
					{...register("password")}
					id="login-password"
					label={<T id="password" />}
					autoComplete="current-password"
					required
					maxLength={255}
					placeholder={intl.formatMessage({ id: "password" })}
				/>
				<Button
					type="submit"
					fullWidth
					color="primary"
					size="lg"
					isLoading={isSubmitting}
					disabled={isSubmitting || Boolean(checkEmail(email.trim())) || password === ""}
				>
					<T id="sign-in" />
				</Button>
			</div>
		</HookForm>
	);
}

function PasswordForm({ oidcError, noRedirect }) {
	const emailRef = useRef(null);
	const [formErr, setFormErr] = useState(null);
	const { login } = useAuthState();
	const health = useHealth();

	const onSubmit = async (values) => {
		setFormErr(null);
		try {
			await login(values.email, values.password);
		} catch (err) {
			setFormErr(err);
		}
	};

	// Once, when the health check first answers: the check repeats every 15 seconds, and refocusing on each
	// answer would move the cursor out of the password field while someone types
	const passwordAllowed = health.data?.password;
	const oidc = health.data?.oidc;
	const oidcActive = oidc?.active === true;
	const startedRef = useRef(false);
	useEffect(() => {
		if (passwordAllowed === undefined || startedRef.current) return;
		startedRef.current = true;
		if (passwordAllowed === false) {
			if (oidcActive && !noRedirect) {
				redirectToOIDC();
			}
		} else if (!emailRef.current?.form?.contains(document.activeElement)) {
			emailRef.current?.focus();
		}
		deleteCookie("__Host-npmpro_oidc_no_redirect");
	}, [passwordAllowed, oidcActive, noRedirect]);

	return (
		<>
			<CardHeader className="text-center">
				<CardTitle role="heading" aria-level={1} className="text-xl">
					<T id="login.title" />
				</CardTitle>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{oidcError !== null && <ErrorAlert error={intl.formatMessage({ id: oidcErrorKey(oidcError) })} />}
				{formErr && <ErrorAlert error={formErr} />}
				{oidcActive && (
					<OidcButton label={oidc.label} color={oidc.color} icon={oidc.icon} onClick={redirectToOIDC} />
				)}
				{oidcActive && passwordAllowed && (
					<FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
						<T id="or" />
					</FieldSeparator>
				)}
				{passwordAllowed && <PasswordFields emailRef={emailRef} onSubmit={onSubmit} />}
			</CardContent>
		</>
	);
}

export default function Login() {
	const { totpChallenge } = useAuthState();
	// Read once: this removes the parameter from the address bar, and the message must survive re-renders
	const [oidcError] = useState(takeOidcError);
	// Latched per page load: the form deletes the cookie after the first health answer
	const [noRedirect] = useState(() => oidcError !== null || getCookie("__Host-npmpro_oidc_no_redirect") === "true");

	return (
		<AuthLayout>
			<Card>{totpChallenge ? <TotpForm /> : <PasswordForm oidcError={oidcError} noRedirect={noRedirect} />}</Card>
		</AuthLayout>
	);
}
