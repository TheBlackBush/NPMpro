import { User } from "lucide-react";
import { useState } from "react";
import { ApiErrorContent, ErrorAlert, FormSubmit, HookForm, Loading, TextField, useAppForm } from "src/components";
import { AvatarRow } from "src/components/AvatarRow";
import { useSetUser, useUser } from "src/hooks";
import { T } from "src/locale";
import { userValidate } from "src/modules/AccountForms";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { AccountPart, PartFormReport } from "./AccountPart";

const validate = userValidate(validations);
const EMPTY = { name: "", email: "" };

// the signed-in user's picture, name and email; Save keeps the window open (the other parts and their edits stay)
export function ProfilePart() {
	const { data, isPending, error } = useUser("me");
	const { mutateAsync: setUser } = useSetUser();
	const [errorMsg, setErrorMsg] = useState(null);
	const methods = useAppForm({
		defaultValues: EMPTY,
		values: data ? { name: data.name ?? "", email: data.email ?? "" } : undefined,
		validate,
	});
	const { isSubmitting } = methods.formState;
	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			// only the name and the email: the own roles and disabled flag are never sent (no lock-out)
			await setUser({ id: "me", name: values.name, email: values.email });
			showObjectSuccess("user", "saved");
			methods.reset(values);
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};
	return (
		<HookForm methods={methods} onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
			<PartFormReport id="profile" />
			<AccountPart
				id="profile"
				icon={User}
				heading={<T id="account.profile" />}
				footer={
					<FormSubmit edit isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="save" />
					</FormSubmit>
				}
			>
				<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
				{error ? <ErrorAlert error={error} /> : null}
				{isPending ? <Loading noLogo /> : null}
				{data ? (
					<>
						<AvatarRow id="me" user={data} onError={setErrorMsg} />
						<TextField name="name" label={<T id="user.full-name" />} autoComplete="off" required />
						<TextField
							name="email"
							type="email"
							label={<T id="email-address" />}
							autoComplete="off"
							required
						/>
					</>
				) : null}
			</AccountPart>
		</HookForm>
	);
}
