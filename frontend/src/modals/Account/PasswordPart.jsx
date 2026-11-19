import { Lock } from "lucide-react";
import { useState } from "react";
import { updateAuth } from "src/api/backend";
import { ApiErrorContent, ErrorAlert, FormSubmit, NoticeAlert } from "src/components";
import { HookForm, PasswordField, useAppForm, useRecheckDependent } from "src/components/Form";
import { useHealth } from "src/hooks";
import { T } from "src/locale";
import { changePasswordValidate } from "src/modules/AccountForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { AccountPart, PartFormReport } from "./AccountPart";

const validate = changePasswordValidate(validations);
const EMPTY = { current: "", new: "", confirm: "" };

// a change re-checks the repeat once its message may show (useRecheckDependent reads the form around it)
function NewPasswordField() {
	const recheckConfirm = useRecheckDependent("confirm");
	return (
		<PasswordField
			name="new"
			label={<T id="user.new-password" />}
			autoComplete="new-password"
			required
			registerOptions={{ onChange: recheckConfirm }}
		/>
	);
}

// The own password. With password sign-in off (OIDC only) the form stays: the password is used again when password
// sign-in is turned back on, and the notice says so. The health check (GET /api, polled) tells whether it is off.
function PasswordForm({ onSaved }) {
	const { data: health } = useHealth();
	const [error, setError] = useState(null);
	const methods = useAppForm({ defaultValues: EMPTY, validate });
	const { isSubmitting } = methods.formState;
	const onSubmit = async (values) => {
		setError(null);
		try {
			await updateAuth("me", values.new, values.current);
			showObjectSuccess("user", "updated");
			onSaved();
		} catch (err) {
			setError(<ApiErrorContent error={err} />);
		}
	};
	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
			<PartFormReport id="password" />
			<AccountPart
				id="password"
				icon={Lock}
				heading={<T id="password" />}
				footer={
					<FormSubmit isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="user.change-password" />
					</FormSubmit>
				}
			>
				<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
				{health?.password === false ? (
					<div className="mb-3" data-account-password-off="">
						<NoticeAlert variant="info">
							<p className="m-0 font-semibold">
								<T id="account.password-off.title" />
							</p>
							<p className="m-0 text-muted-foreground">
								<T id="account.password-off.text" />
							</p>
						</NoticeAlert>
					</div>
				) : null}
				<NoticeAlert className="mb-3">
					<T id="logout-other-devices" />
				</NoticeAlert>
				<PasswordField
					name="current"
					label={<T id="user.current-password" />}
					autoComplete="current-password"
					required
				/>
				<NewPasswordField />
				<PasswordField
					name="confirm"
					label={<T id="user.confirm-password" />}
					autoComplete="new-password"
					required
				/>
			</AccountPart>
		</HookForm>
	);
}

// After a saved change the form starts again (a new instance): the fields are empty and the part has no unsaved
// change, with nothing of the submitted state left (a reset inside the submit handler is undone by the form's own state
// after the handler, and a reset after it kept the touched and submitted marks, so the first key showed a message)
export function PasswordPart() {
	const [generation, setGeneration] = useState(0);
	return <PasswordForm key={generation} onSaved={() => setGeneration((current) => current + 1)} />;
}
