import { useEffect, useRef, useState } from "react";
import { checkResetToken, confirmPasswordReset } from "src/api/backend";
import {
	ApiErrorContent,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	Loading,
	NoticeAlert,
	useAppForm,
} from "src/components";
import { PasswordInput } from "src/components/Form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "src/components/ui/card";
import { intl, T } from "src/locale";
import { resetPasswordValidate } from "src/modules/AccountForms";
import { resetWording } from "src/modules/Invitations";
import { resetTokenOf } from "src/modules/ResetPassword";
import { validations } from "src/modules/Validations";
import { AuthLayout } from "src/shell/AuthLayout";
import { BackToSignIn } from "../ForgotPassword/BackToSignIn";

// The token comes in the address fragment. It is read once and removed from the address bar at once (before
// anything else runs), and kept in memory only: never in a request line, a storage or a log. The history entry keeps
// it too (history.state is not sent anywhere), so a reload, such as the language switch, finds it again. A module
// variable survives the second render of development mode, where the fragment is already gone.
let heldToken = "";
function takeToken() {
	const token = resetTokenOf(window.location.hash, window.history.state);
	if (token !== "") {
		heldToken = token;
		window.history.replaceState({ resetToken: token }, "", window.location.pathname + window.location.search);
	}
	return heldToken;
}

// after a saved password the token is gone from memory and from the history entry
function dropToken() {
	heldToken = "";
	window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

const validate = resetPasswordValidate(validations);

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

function NewPasswordForm({ token, purpose, onDone, onInvalid }) {
	const [error, setError] = useState(null);
	const methods = useAppForm({ defaultValues: { new: "", confirm: "" }, validate });
	const { register } = methods;
	const { errors, isSubmitting } = methods.formState;
	const onSubmit = async (values) => {
		setError(null);
		try {
			await confirmPasswordReset(token, values.new);
			dropToken();
			onDone();
		} catch (err) {
			if (err?.payload?.error?.message_i18n === "error.reset-invalid") {
				dropToken();
				onInvalid();
			} else if (err?.status === 429) {
				setError(intl.formatMessage({ id: "error.too-many-requests" }));
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
					<T id={resetWording(purpose).button} />
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
	// "checking", "form", "invalid", "failed" (the check could not be made) or "done"
	const [step, setStep] = useState(token === "" ? "invalid" : "checking");
	const [attempt, setAttempt] = useState(0);
	const [failure, setFailure] = useState(null);
	// what the link is for, as the check answers: "invite" (a new account) or "reset"
	const [purpose, setPurpose] = useState(null);
	const checkedAttempt = useRef(-1);

	// only a 400 (error.reset-invalid) means the link is no good; a 429 or any other failure may pass
	useEffect(() => {
		if (token === "" || checkedAttempt.current === attempt) return;
		checkedAttempt.current = attempt;
		checkResetToken(token).then(
			(answer) => {
				setPurpose(answer?.purpose ?? "reset");
				setStep("form");
			},
			(err) => {
				if (err?.status === 400) {
					setStep("invalid");
				} else {
					setFailure(err?.status === 429 ? intl.formatMessage({ id: "error.too-many-requests" }) : err);
					setStep("failed");
				}
			},
		);
	}, [token, attempt]);

	const retry = () => {
		setStep("checking");
		setAttempt((n) => n + 1);
	};

	let body = null;
	if (step === "checking") {
		body = <Loading noLogo />;
	} else if (step === "failed") {
		body = (
			<CardContent className="flex flex-col gap-4">
				<ErrorAlert error={failure} />
				<Button type="button" fullWidth color="primary" size="lg" onClick={retry}>
					<T id="reset-password.retry" />
				</Button>
				<BackToSignIn />
			</CardContent>
		);
	} else if (step === "invalid") {
		body = <InvalidLink />;
	} else if (step === "done") {
		body = (
			<CardContent className="flex flex-col gap-4">
				<NoticeAlert variant="info">
					<T id={resetWording(purpose).done} />
				</NoticeAlert>
				<a href="/" className="text-center text-sm underline underline-offset-4">
					<T id="sign-in" />
				</a>
			</CardContent>
		);
	} else {
		body = (
			<NewPasswordForm
				token={token}
				purpose={purpose}
				onDone={() => setStep("done")}
				onInvalid={() => setStep("invalid")}
			/>
		);
	}

	return (
		<AuthLayout>
			<Card>
				{step === "checking" ? null : (
					<CardHeader className="text-center">
						<CardTitle role="heading" aria-level={1} className="text-xl">
							<T id={resetWording(step === "form" ? purpose : null).title} />
						</CardTitle>
						{step === "form" ? (
							<CardDescription>
								<T id="reset-password.description" />
							</CardDescription>
						) : null}
					</CardHeader>
				)}
				{body}
			</Card>
		</AuthLayout>
	);
}
