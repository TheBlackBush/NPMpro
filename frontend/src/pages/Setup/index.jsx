import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createSetupUser } from "src/api/backend";
import { ApiErrorContent, ErrorAlert, FormSubmit, HookForm, useAppForm } from "src/components";
import { PasswordInput } from "src/components/Form";
import { FieldMessage } from "src/components/Form/FieldMessage";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "src/components/ui/card";
import { Field, FieldLabel } from "src/components/ui/field";
import { Input } from "src/components/ui/input";
import { useAuthState } from "src/context";
import { useHealth } from "src/hooks";
import { intl, T } from "src/locale";
import { setupValidate } from "src/modules/AccountForms";
import { validations } from "src/modules/Validations";
import { AuthLayout } from "src/shell/AuthLayout";

const validate = setupValidate(validations);

/** A labelled text input with its error under it, for the setup form */
function TextField({ id, type = "text", autoComplete, labelId, register, error }) {
	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>
				<T id={labelId} />
			</FieldLabel>
			<Input
				{...register(id)}
				id={id}
				type={type}
				autoComplete={autoComplete}
				required
				aria-invalid={error ? "true" : undefined}
				aria-describedby={error ? `${id}-error` : undefined}
				placeholder={intl.formatMessage({ id: labelId })}
			/>
			{error ? <FieldMessage id={`${id}-error`}>{error.message}</FieldMessage> : null}
		</Field>
	);
}

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
		<AuthLayout width="md">
			<Card>
				<HookForm methods={methods} onSubmit={onSubmit} className="contents">
					<CardHeader className="text-center">
						<CardTitle role="heading" aria-level={1} className="text-xl">
							<T id="setup.title" />
						</CardTitle>
						<CardDescription>
							<T id="setup.preamble" />
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						<TextField
							id="name"
							autoComplete="name"
							labelId="user.full-name"
							register={register}
							error={errors.name}
						/>
						<TextField
							id="email"
							type="email"
							autoComplete="username"
							labelId="email-address"
							register={register}
							error={errors.email}
						/>
						<PasswordInput
							{...register("password")}
							id="password"
							label={<T id="user.new-password" />}
							autoComplete="new-password"
							required
							error={errors.password?.message ?? null}
							placeholder={intl.formatMessage({ id: "user.new-password" })}
						/>
					</CardContent>
					<CardFooter className="flex-col">
						<FormSubmit
							stacked
							className="w-full"
							messageId="form.fix-fields.continue"
							color="primary"
							size="lg"
							isLoading={isSubmitting}
							disabled={isSubmitting}
						>
							<T id="setup.create-account" />
						</FormSubmit>
					</CardFooter>
				</HookForm>
			</Card>
		</AuthLayout>
	);
}
