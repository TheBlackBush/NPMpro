import { useQueryClient } from "@tanstack/react-query";
import { Field, Form, Formik } from "formik";
import { useState } from "react";
import { createSetupUser } from "src/api/backend";
import { ApiErrorContent, BrandMark, Button, ErrorAlert, LocalePicker, Page, ThemeSwitcher } from "src/components";
import { PasswordInput } from "src/components/Form";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { validateEmail, validateString } from "src/modules/Validations";

export default function Setup() {
	const queryClient = useQueryClient();
	const { login } = useAuthState();
	const health = useHealth();
	const [errorMsg, setErrorMsg] = useState(null);

	const onSubmit = async (values, { setSubmitting }) => {
		setErrorMsg(null);

		const { password, ...payload } = {
			...values,
			auth: {
				type: "password",
				secret: values.password,
			},
		};

		try {
			const user = await createSetupUser(payload);
			if (health.data?.password === false) {
				window.location.href = "/api/oidc";
				return;
			}
			try {
				await login(user.email, password);
				// Trigger a Health change
				await queryClient.refetchQueries({ queryKey: ["health"] });
				// window.location.reload();
			} catch (err) {
				setErrorMsg(<ApiErrorContent error={err} />);
			}
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
		setSubmitting(false);
	};

	return (
		<Page className="page-center">
			<div className="container container-tight py-4">
				<div className="d-flex justify-content-end gap-2 mb-3">
					<LocalePicker />
					<ThemeSwitcher />
				</div>
				<div className="text-center mb-4">
					<div className="navbar-brand fs-1">
						<BrandMark variant="stacked" size={160} alt="NPMpro" className="navbar-brand-image" />
					</div>
				</div>
				<div className="card card-md">
					<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
					<Formik
						initialValues={{
							name: "",
							email: "",
							password: "",
						}}
						onSubmit={onSubmit}
					>
						{({ isSubmitting }) => (
							<Form>
								<div className="card-body text-center py-4 p-sm-5">
									<h1 className="mt-5">
										<T id="setup.title" />
									</h1>
									<p className="text-secondary">
										<T id="setup.preamble" />
									</p>
								</div>
								<hr />
								<div className="card-body">
									<div className="mb-3">
										<Field name="name" validate={validateString(1, 255)}>
											{({ field, form }) => (
												<>
													<label className="form-label" htmlFor="name">
														<T id="user.full-name" />
													</label>
													<input
														{...field}
														id="name"
														autoComplete="name"
														required
														className={`form-control ${form.errors.name && form.touched.name ? "is-invalid" : ""}`}
														placeholder={intl.formatMessage({ id: "user.full-name" })}
													/>
													{form.errors.name ? (
														<div className="invalid-feedback">
															{form.touched.name ? form.errors.name : null}
														</div>
													) : null}
												</>
											)}
										</Field>
									</div>
									<div className="mb-3">
										<Field name="email" validate={validateEmail()}>
											{({ field, form }) => (
												<>
													<label className="form-label" htmlFor="email">
														<T id="email-address" />
													</label>
													<input
														{...field}
														id="email"
														type="email"
														autoComplete="username"
														required
														className={`form-control ${form.errors.email && form.touched.email ? "is-invalid" : ""}`}
														placeholder={intl.formatMessage({ id: "email-address" })}
													/>
													{form.errors.email ? (
														<div className="invalid-feedback">
															{form.touched.email ? form.errors.email : null}
														</div>
													) : null}
												</>
											)}
										</Field>
									</div>
									<div className="mb-3">
										<Field name="password" validate={validateString(8, 255, false)}>
											{({ field, form }) => (
												<PasswordInput
													{...field}
													id="password"
													label={<T id="user.new-password" />}
													autoComplete="new-password"
													required
													error={
														form.errors.password && form.touched.password
															? form.errors.password
															: null
													}
													placeholder={intl.formatMessage({ id: "user.new-password" })}
												/>
											)}
										</Field>
									</div>
								</div>
								<div className="text-center my-3 mx-3">
									<Button
										type="submit"
										color="primary"
										isLoading={isSubmitting}
										disabled={isSubmitting}
										className="w-100"
									>
										<T id="setup.create-account" />
									</Button>
								</div>
							</Form>
						)}
					</Formik>
				</div>
			</div>
		</Page>
	);
}
