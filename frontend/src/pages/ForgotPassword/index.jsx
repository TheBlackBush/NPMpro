import { useState } from "react";
import { requestPasswordReset } from "src/api/backend";
import { Button, ErrorAlert, HookForm, NoticeAlert, useAppForm } from "src/components";
import { FieldMessage } from "src/components/Form/FieldMessage";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "src/components/ui/card";
import { Field, FieldLabel } from "src/components/ui/field";
import { Input } from "src/components/ui/input";
import { intl, T } from "src/locale";
import { validateEmail } from "src/modules/Validations";
import { AuthLayout } from "src/shell/AuthLayout";
import { BackToSignIn } from "./BackToSignIn";

const checkEmail = validateEmail();

/**
 * The address and Send. After any answer but "too many requests" the same text shows, whether or not an account
 * exists; the server answers the same way.
 */
export default function ForgotPassword() {
	const [outcome, setOutcome] = useState(null);
	const [error, setError] = useState(null);
	const methods = useAppForm({ defaultValues: { email: "" } });
	const { register } = methods;
	const { isSubmitting, touchedFields } = methods.formState;
	const email = methods.watch("email");
	const hint = touchedFields.email && email.trim() !== "" ? (checkEmail(email.trim()) ?? null) : null;

	const onSubmit = async (values) => {
		setError(null);
		try {
			await requestPasswordReset(values.email.trim());
			setOutcome("sent");
		} catch (err) {
			if (err?.status === 429) {
				setOutcome("limited");
			} else if (err?.status === undefined) {
				// no answer at all (offline): nothing was asked
				setError(err);
			} else {
				setOutcome("sent");
			}
		}
	};

	return (
		<AuthLayout>
			<Card>
				<CardHeader className="text-center">
					<CardTitle role="heading" aria-level={1} className="text-xl">
						<T id="forgot-password.title" />
					</CardTitle>
					{outcome === null ? (
						<CardDescription>
							<T id="forgot-password.description" />
						</CardDescription>
					) : null}
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{outcome === "sent" ? (
						<NoticeAlert variant="info">
							<T id="forgot-password.sent" />
						</NoticeAlert>
					) : null}
					{outcome === "limited" ? (
						<ErrorAlert error={intl.formatMessage({ id: "error.too-many-requests" })} />
					) : null}
					{outcome !== "sent" ? (
						<HookForm methods={methods} onSubmit={onSubmit}>
							<div className="flex flex-col gap-4">
								{error ? <ErrorAlert error={error} /> : null}
								<Field data-invalid={hint ? true : undefined}>
									<FieldLabel htmlFor="forgot-email">
										<T id="email-address" />
									</FieldLabel>
									<Input
										{...register("email")}
										id="forgot-email"
										type="email"
										autoComplete="username"
										required
										autoFocus
										aria-invalid={hint ? "true" : undefined}
										aria-describedby={hint ? "forgot-email-error" : undefined}
										placeholder={intl.formatMessage({ id: "email-address" })}
									/>
									{hint ? <FieldMessage id="forgot-email-error">{hint}</FieldMessage> : null}
								</Field>
								<Button
									type="submit"
									fullWidth
									color="primary"
									size="lg"
									isLoading={isSubmitting}
									disabled={isSubmitting || Boolean(checkEmail(email.trim()))}
								>
									<T id="forgot-password.send" />
								</Button>
							</div>
						</HookForm>
					) : null}
					<BackToSignIn />
				</CardContent>
			</Card>
		</AuthLayout>
	);
}
