import { useEffect, useRef, useState } from "react";
import { checkResetToken, confirmPasswordReset } from "src/api/backend";
import { ApiErrorContent, ErrorAlert, FormSubmit, HookForm, Loading, NoticeAlert, useAppForm } from "src/components";
import { PasswordInput } from "src/components/Form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "src/components/ui/card";
import { intl, T } from "src/locale";
import { PASSWORD_MAX, PASSWORD_MIN, passwordPairValidate, tokenFromHash } from "src/modules/ResetPassword";
import { AuthLayout } from "src/shell/AuthLayout";
import { BackToSignIn } from "../ForgotPassword/BackToSignIn";

// The token comes in the address fragment. It is read once and removed from the address bar at once (before
// anything else runs), and kept in memory only: never in a request line, a storage or a log. A module variable
// survives the second render of development mode, where the fragment is already gone.
let heldToken = "";
function takeToken() {
	const token = tokenFromHash(window.location.hash);
	if (token !== "") {
		heldToken = token;
		window.history.replaceState(null, "", window.location.pathname + window.location.search);
	}
	return heldToken;
}

const REASONS = {
	required: () => intl.formatMessage({ id: "error.required" }),
	short: () => intl.formatMessage({ id: "error.min-character-length" }, { min: PASSWORD_MIN }),
	long: () => intl.formatMessage({ id: "error.max-character-length" }, { max: PASSWORD_MAX }),
	mismatch: () => intl.formatMessage({ id: "error.passwords-must-match" }),
};

const validate = (values) => {
	const problem = passwordPairValidate(values.new, values.confirm);
	return problem ? { [problem.field]: REASONS[problem.reason]() } : {};
};

function InvalidLink() {
	return (
		<CardContent className="flex flex-col gap-4">
			<ErrorAlert error={intl.formatMessage({ id: "error.reset-invalid" })} />
			<a href="/forgot-password" className="text-center text-sm underline underline-offset-4">
				<T id="reset-password.request-new" />
			</a>
			<BackToSignIn />
		</CardContent>
	);
}

function NewPasswordForm({ token, onDone, onInvalid }) {
	const [error, setError] = useState(null);
	const methods = useAppForm({ defaultValues: { new: "", confirm: "" }, validate });
	const { register } = methods;
	const { errors, isSubmitting } = methods.formState;
	const onSubmit = async (values) => {
		setError(null);
		try {
			await confirmPasswordReset(token, values.new);
			onDone();
		} catch (err) {
			if (err?.payload?.error?.message_i18n === "error.reset-invalid") {
				onInvalid();
			} else {
				setError(<ApiErrorContent error={err} />);
			}
		}
	};
	return (
		<HookForm methods={methods} onSubmit={onSubmit}>
			<CardContent className="flex flex-col gap-4">
				<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
				<PasswordInput
					{...register("new")}
					id="reset-new-password"
					label={<T id="user.new-password" />}
					autoComplete="new-password"
					required
					autoFocus
					error={errors.new?.message ?? null}
					placeholder={intl.formatMessage({ id: "user.new-password" })}
				/>
				<PasswordInput
					{...register("confirm")}
					id="reset-confirm-password"
					label={<T id="user.confirm-password" />}
					autoComplete="new-password"
					required
					error={errors.confirm?.message ?? null}
					placeholder={intl.formatMessage({ id: "user.confirm-password" })}
				/>
				<FormSubmit
					stacked
					messageId="form.fix-fields.continue"
					color="primary"
					size="lg"
					isLoading={isSubmitting}
				>
					<T id="save" />
				</FormSubmit>
				<BackToSignIn />
			</CardContent>
		</HookForm>
	);
}

/**
 * The page of the link in the reset mail: it checks the token, asks for the new password twice, saves it and points
 * to the sign-in page. Needs no session, and makes no call that needs one.
 */
export default function ResetPassword() {
	const [token] = useState(takeToken);
	// "checking", "form", "invalid" or "done"
	const [step, setStep] = useState(token === "" ? "invalid" : "checking");
	const checked = useRef(false);

	useEffect(() => {
		if (token === "" || checked.current) return;
		checked.current = true;
		checkResetToken(token).then(
			() => setStep("form"),
			() => setStep("invalid"),
		);
	}, [token]);

	let body = null;
	if (step === "checking") {
		body = <Loading noLogo />;
	} else if (step === "invalid") {
		body = <InvalidLink />;
	} else if (step === "done") {
		body = (
			<CardContent className="flex flex-col gap-4">
				<NoticeAlert variant="info">
					<T id="reset-password.done" />
				</NoticeAlert>
				<a href="/" className="text-center text-sm underline underline-offset-4">
					<T id="sign-in" />
				</a>
			</CardContent>
		);
	} else {
		body = <NewPasswordForm token={token} onDone={() => setStep("done")} onInvalid={() => setStep("invalid")} />;
	}

	return (
		<AuthLayout>
			<Card>
				<CardHeader className="text-center">
					<CardTitle role="heading" aria-level={1} className="text-xl">
						<T id="reset-password.title" />
					</CardTitle>
					{step === "form" ? (
						<CardDescription>
							<T id="reset-password.description" />
						</CardDescription>
					) : null}
				</CardHeader>
				{body}
			</Card>
		</AuthLayout>
	);
}
