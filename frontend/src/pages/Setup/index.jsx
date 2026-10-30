import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createSetupUser } from "src/api/backend";
import {
	ApiErrorContent,
	BrandMark,
	ErrorAlert,
	FormSubmit,
	HookForm,
	LocalePicker,
	Page,
	ThemeSwitcher,
	useAppForm,
} from "src/components";
import { PasswordInput } from "src/components/Form";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { setupValidate } from "src/modules/AccountForms";
import { validations } from "src/modules/Validations";

const validate = setupValidate(validations);

export default function Setup() {
	const queryClient = useQueryClient();
	const { login } = useAuthState();
	const health = useHealth();
	const [errorMsg, setErrorMsg] = useState(null);
	const methods = useAppForm({ defaultValues: { name: "", email: "", password: "" }, validate });
	const {
		register,
		formState: { errors, isSubmitting },
	} = methods;

	const onSubmit = async (values) => {
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
				// the browser leaves for the sign-in provider: the button stays busy until it has left
				return new Promise(() => undefined);
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
					<HookForm methods={methods} onSubmit={onSubmit}>
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
								<label className="form-label" htmlFor="name">
									<T id="user.full-name" />
								</label>
								<input
									{...register("name")}
									id="name"
									autoComplete="name"
									required
									className={`form-control ${errors.name ? "is-invalid" : ""}`}
									placeholder={intl.formatMessage({ id: "user.full-name" })}
								/>
								{errors.name ? <div className="invalid-feedback">{errors.name.message}</div> : null}
							</div>
							<div className="mb-3">
								<label className="form-label" htmlFor="email">
									<T id="email-address" />
								</label>
								<input
									{...register("email")}
									id="email"
									type="email"
									autoComplete="username"
									required
									className={`form-control ${errors.email ? "is-invalid" : ""}`}
									placeholder={intl.formatMessage({ id: "email-address" })}
								/>
								{errors.email ? <div className="invalid-feedback">{errors.email.message}</div> : null}
							</div>
							<div className="mb-3">
								<PasswordInput
									{...register("password")}
									id="password"
									label={<T id="user.new-password" />}
									autoComplete="new-password"
									required
									error={errors.password?.message ?? null}
									placeholder={intl.formatMessage({ id: "user.new-password" })}
								/>
							</div>
						</div>
						<div className="text-center my-3 mx-3">
							<FormSubmit
								stacked
								messageId="form.fix-fields.continue"
								color="primary"
								isLoading={isSubmitting}
								disabled={isSubmitting}
							>
								<T id="setup.create-account" />
							</FormSubmit>
						</div>
					</HookForm>
				</div>
			</div>
		</Page>
	);
}
