import { useEffect, useRef, useState } from "react";
import { useWatch } from "react-hook-form";
import {
	BrandMark,
	Button,
	ErrorAlert,
	HookForm,
	LocalePicker,
	MaintenanceBanner,
	OidcButton,
	Page,
	ThemeSwitcher,
	useAppForm,
} from "src/components";
import { CodeEntry, PasswordInput } from "src/components/Form";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { CODE_VALUES, codeComplete, codeOf } from "src/modules/AccountForms";
import { getCookie } from "src/modules/Cookies";
import { oidcErrorKey, takeOidcError } from "src/modules/Oidc";
import { validateEmail } from "src/modules/Validations";

// Sign in is enabled only for a valid email address and a password
const checkEmail = validateEmail();

// the invalid-address hint once the field was left with something typed in it (an empty field shows nothing)
const emailHint = (value, touched) => (touched && value.trim() !== "" ? (checkEmail(value.trim()) ?? null) : null);

const CODE_FIELDS = ["code", "backupCode", "useBackup"];

/**
 * The code (the six boxes, or a backup code) and the buttons; Verify waits for a complete code. A refused code
 * empties its field and puts the focus back in it.
 */
function TotpCodeForm({ onSubmit }) {
	const { cancelTotp } = useAuthState();
	const methods = useAppForm({ defaultValues: CODE_VALUES, keepEdits: false });
	const { isSubmitting } = methods.formState;
	const { setFocus } = methods;
	const [code, backupCode, useBackup] = useWatch({ control: methods.control, name: CODE_FIELDS });
	useEffect(() => {
		setFocus("code");
	}, [setFocus]);
	const submit = async (values) => {
		if (await onSubmit({ code: codeOf(values) })) return;
		methods.reset({ ...CODE_VALUES, useBackup: values.useBackup });
		setFocus(values.useBackup ? "backupCode" : "code");
	};
	return (
		<HookForm methods={methods} onSubmit={submit}>
			<CodeEntry idPrefix="login-totp" label={<T id="login.totp-code" />} allowBackup />
			<div className="form-footer d-flex gap-2 align-items-start">
				<Button type="button" fullWidth onClick={cancelTotp} disabled={isSubmitting}>
					<T id="cancel" />
				</Button>
				<Button
					type="submit"
					fullWidth
					color="azure"
					isLoading={isSubmitting}
					disabled={isSubmitting || !codeComplete({ code, backupCode, useBackup })}
				>
					<T id="login.totp-verify" />
				</Button>
			</div>
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

	return (
		<>
			<h2 className="h2 text-center mb-4">
				<T id="login.totp-title" />
			</h2>
			<p className="text-secondary text-center mb-4">
				<T id="login.totp-description" />
			</p>
			{formErr && <ErrorAlert error={formErr} />}
			<TotpCodeForm onSubmit={onSubmit} />
		</>
	);
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
			<div className="mb-3">
				<label className="form-label" htmlFor="login-email">
					<T id="email-address" />
				</label>
				<input
					{...emailField}
					ref={(input) => {
						emailFieldRef(input);
						emailRef.current = input;
					}}
					id="login-email"
					type="email"
					autoComplete="username"
					required
					className={`form-control ${hint ? "is-invalid" : ""}`}
					aria-invalid={hint ? "true" : undefined}
					aria-describedby={hint ? "login-email-error" : undefined}
					placeholder={intl.formatMessage({ id: "email-address" })}
				/>
				{hint ? (
					<div className="invalid-feedback" id="login-email-error">
						{hint}
					</div>
				) : null}
			</div>
			<div className="mb-2">
				<PasswordInput
					{...register("password")}
					id="login-password"
					label={<T id="password" />}
					autoComplete="current-password"
					required
					maxLength={255}
					placeholder={intl.formatMessage({ id: "password" })}
				/>
			</div>
			<div className="form-footer">
				<Button
					type="submit"
					fullWidth
					color="azure"
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
		window.cookieStore.delete("__Host-npmpro_oidc_no_redirect");
	}, [passwordAllowed, oidcActive, noRedirect]);

	return (
		<>
			<h2 className="h2 text-center mb-4">
				<T id="login.title" />
			</h2>
			{oidcError !== null && <ErrorAlert error={intl.formatMessage({ id: oidcErrorKey(oidcError) })} />}
			{formErr && <ErrorAlert error={formErr} />}
			{oidcActive && (
				<OidcButton label={oidc.label} color={oidc.color} icon={oidc.icon} onClick={redirectToOIDC} />
			)}
			{oidcActive && passwordAllowed && (
				<div className="hr-text my-3">
					<T id="or" />
				</div>
			)}
			{passwordAllowed && <PasswordFields emailRef={emailRef} onSubmit={onSubmit} />}
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
		<Page className="page-center">
			<div className="container container-tight py-4">
				<div className="d-flex justify-content-end gap-2 mb-3">
					<LocalePicker />
					<ThemeSwitcher />
				</div>
				<MaintenanceBanner />
				<div className="text-center mb-4">
					<h1 className="navbar-brand fs-1">
						<BrandMark variant="stacked" size={160} alt="NPMpro" className="navbar-brand-image" />
					</h1>
				</div>
				<div className="card card-md">
					<div className="card-body">
						{totpChallenge ? <TotpForm /> : <PasswordForm oidcError={oidcError} noRedirect={noRedirect} />}
					</div>
				</div>
			</div>
		</Page>
	);
}
