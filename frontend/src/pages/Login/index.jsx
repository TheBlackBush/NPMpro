import { Field, Form, Formik } from "formik";
import { useEffect, useRef, useState } from "react";
import { BrandMark, Button, ErrorAlert, LocalePicker, OidcButton, Page, ThemeSwitcher } from "src/components";
import { PasswordInput } from "src/components/Form";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { getCookie } from "src/modules/Cookies";
import { oidcErrorKey, takeOidcError } from "src/modules/Oidc";
import { validateEmail } from "src/modules/Validations";

// Sign in is enabled only for a valid email address and a password
const checkEmail = validateEmail();

// the invalid-address hint once the field was left with something typed in it (an empty field shows nothing)
const emailHint = (value, touched) => (touched && value.trim() !== "" ? (checkEmail(value.trim()) ?? null) : null);

function TotpForm() {
	const codeRef = useRef(null);
	const [formErr, setFormErr] = useState(null);
	const { submitTotp, cancelTotp } = useAuthState();

	const onSubmit = async (values, { setSubmitting, resetForm }) => {
		setFormErr(null);
		try {
			await submitTotp(values);
		} catch (err) {
			setFormErr(err);
			resetForm();
		}
		setSubmitting(false);
	};

	useEffect(() => {
		codeRef.current?.focus();
	});

	return (
		<>
			<h2 className="h2 text-center mb-4">
				<T id="login.totp-title" />
			</h2>
			<p className="text-secondary text-center mb-4">
				<T id="login.totp-description" />
			</p>
			{formErr && <ErrorAlert error={formErr} />}
			<Formik initialValues={{ code: "" }} onSubmit={onSubmit}>
				{({ isSubmitting, values }) => (
					<Form noValidate>
						<div className="mb-3">
							<Field name="code">
								{({ field }) => (
									<PasswordInput
										{...field}
										id="login-totp-code"
										label={<T id="login.totp-code" />}
										ref={codeRef}
										textWhenEmpty
										autoComplete="one-time-code"
										required
										maxLength={8}
										placeholder={intl.formatMessage({ id: "login.totp-code-placeholder" })}
									/>
								)}
							</Field>
						</div>
						<div className="form-footer d-flex gap-2 align-items-start">
							<Button type="button" fullWidth onClick={cancelTotp} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<Button
								type="submit"
								fullWidth
								color="azure"
								isLoading={isSubmitting}
								disabled={isSubmitting || values.code.trim() === ""}
							>
								<T id="login.totp-verify" />
							</Button>
						</div>
					</Form>
				)}
			</Formik>
		</>
	);
}

const redirectToOIDC = () => {
	window.location.href = "/api/oidc";
};

function PasswordForm({ oidcError, noRedirect }) {
	const emailRef = useRef(null);
	const [formErr, setFormErr] = useState(null);
	const { login } = useAuthState();
	const health = useHealth();

	const onSubmit = async (values, { setSubmitting }) => {
		setFormErr(null);
		try {
			await login(values.email, values.password);
		} catch (err) {
			setFormErr(err);
		}
		setSubmitting(false);
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
			{passwordAllowed && (
				<Formik
					initialValues={{
						email: "",
						password: "",
					}}
					onSubmit={onSubmit}
				>
					{({ isSubmitting, values }) => (
						<Form noValidate>
							<div className="mb-3">
								<Field name="email">
									{({ field, meta }) => (
										<>
											<label className="form-label" htmlFor="login-email">
												<T id="email-address" />
											</label>
											<input
												{...field}
												id="login-email"
												ref={emailRef}
												type="email"
												autoComplete="username"
												required
												className={`form-control ${emailHint(field.value, meta.touched) ? "is-invalid" : ""}`}
												aria-invalid={emailHint(field.value, meta.touched) ? "true" : undefined}
												aria-describedby={
													emailHint(field.value, meta.touched)
														? "login-email-error"
														: undefined
												}
												placeholder={intl.formatMessage({ id: "email-address" })}
											/>
											{emailHint(field.value, meta.touched) ? (
												<div className="invalid-feedback" id="login-email-error">
													{emailHint(field.value, meta.touched)}
												</div>
											) : null}
										</>
									)}
								</Field>
							</div>
							<div className="mb-2">
								<Field name="password">
									{({ field }) => (
										<PasswordInput
											{...field}
											id="login-password"
											label={<T id="password" />}
											autoComplete="current-password"
											required
											maxLength={255}
											placeholder={intl.formatMessage({ id: "password" })}
										/>
									)}
								</Field>
							</div>
							<div className="form-footer">
								<Button
									type="submit"
									fullWidth
									color="azure"
									isLoading={isSubmitting}
									disabled={
										isSubmitting ||
										Boolean(checkEmail(values.email.trim())) ||
										values.password === ""
									}
								>
									<T id="sign-in" />
								</Button>
							</div>
						</Form>
					)}
				</Formik>
			)}
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
