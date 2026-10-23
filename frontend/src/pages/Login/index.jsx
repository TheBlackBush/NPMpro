import { Field, Form, Formik } from "formik";
import { useEffect, useRef, useState } from "react";
import { Button, ErrorAlert, LocalePicker, Page, ThemeSwitcher } from "src/components";
import { PasswordInput } from "src/components/Form";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { getCookie } from "src/modules/Cookies";
import { validateEmail, validateString } from "src/modules/Validations";

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
				{({ isSubmitting }) => (
					<Form>
						<div className="mb-3">
							<Field name="code" validate={validateString(6, 8)}>
								{({ field, form }) => (
									<>
										<PasswordInput
											{...field}
											id="login-totp-code"
											label={<T id="login.totp-code" />}
											ref={codeRef}
											textWhenEmpty
											autoComplete="one-time-code"
											required
											maxLength={8}
											error={form.errors.code && form.touched.code ? form.errors.code : null}
											placeholder={intl.formatMessage({ id: "login.totp-code-placeholder" })}
										/>
									</>
								)}
							</Field>
						</div>
						<div className="form-footer d-flex gap-2">
							<Button type="button" fullWidth onClick={cancelTotp} disabled={isSubmitting}>
								<T id="cancel" />
							</Button>
							<Button
								type="submit"
								fullWidth
								color="azure"
								isLoading={isSubmitting}
								disabled={isSubmitting}
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

function PasswordForm() {
	const emailRef = useRef(null);
	const [formErr, setFormErr] = useState(null);
	const { login } = useAuthState();
	const health = useHealth();

	const redirectToOIDC = () => {
		window.location.href = "/api/oidc";
	};

	const onSubmit = async (values, { setSubmitting }) => {
		setFormErr(null);
		try {
			await login(values.email, values.password);
		} catch (err) {
			setFormErr(err);
		}
		setSubmitting(false);
	};

	useEffect(() => {
		if (health.data?.password === false) {
			if (getCookie("__Host-npmpro_oidc_no_redirect") !== "true") {
				redirectToOIDC();
			}
		} else {
			emailRef.current?.focus();
		}
		window.cookieStore.delete("__Host-npmpro_oidc_no_redirect");
	});

	return (
		<>
			<h2 className="h2 text-center mb-4">
				<T id="login.title" />
			</h2>
			{formErr && <ErrorAlert error={formErr} />}
			{health.data?.password && (
				<Formik
					initialValues={{
						email: "",
						password: "",
					}}
					onSubmit={onSubmit}
				>
					{({ isSubmitting }) => (
						<Form>
							<div className="mb-3">
								<Field name="email" validate={validateEmail()}>
									{({ field, form }) => (
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
												className={`form-control ${form.errors.email && form.touched.email ? "is-invalid" : ""}`}
												placeholder={intl.formatMessage({ id: "email-address" })}
											/>
											<div className="invalid-feedback">{form.errors.email}</div>
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
									disabled={isSubmitting}
								>
									<T id="sign-in" />
								</Button>
							</div>
						</Form>
					)}
				</Formik>
			)}
			{health.data?.password && health.data?.oidc && (
				<div className="hr-text my-3">
					<T id="or" />
				</div>
			)}
			{health.data?.oidc && (
				<div className="form-footer my-0">
					<Button type="button" fullWidth color="azure" onClick={redirectToOIDC}>
						<T id="sign-in-with-oidc" />
					</Button>
				</div>
			)}
		</>
	);
}

export default function Login() {
	const { totpChallenge } = useAuthState();

	return (
		<Page className="page-center">
			<div className="container container-tight py-4">
				<div className="d-flex justify-content-between align-items-center mb-4 ps-4 pe-3">
					<img width={200} src="/images/logo-text-horizontal-grey.png" alt="NPMpro" />
					<div className="d-flex align-items-center gap-1">
						<LocalePicker />
						<ThemeSwitcher />
					</div>
				</div>
				<div className="card card-md">
					<div className="card-body">{totpChallenge ? <TotpForm /> : <PasswordForm />}</div>
				</div>
			</div>
		</Page>
	);
}
