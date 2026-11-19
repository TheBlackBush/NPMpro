import { User } from "lucide-react";
import { useState } from "react";
import {
	ApiErrorContent,
	ErrorAlert,
	FormSection,
	FormSubmit,
	HookForm,
	Loading,
	SwitchField,
	SwitchList,
	TextField,
	useAppForm,
} from "src/components";
import { AvatarRow } from "src/components/AvatarRow";
import { useSetUser, useUser } from "src/hooks";
import { T } from "src/locale";
import { userValidate } from "src/modules/AccountForms";
import { isAdmin } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { showObjectSuccess } from "src/notifications";
import { AccountPart, PartFormReport } from "./AccountPart";

const validate = userValidate(validations);
const EMPTY = { name: "", email: "", isAdmin: false, isDisabled: false };

// a user's picture, name and email (the signed-in user's, or another user's for an administrator, who also sees the
// Administrator and Disabled switches); Save keeps the window open (the other parts and their edits stay)
export function ProfilePart({ userId = "me" }) {
	const self = userId === "me";
	const { data, isPending, error } = useUser(userId);
	const { mutateAsync: setUser } = useSetUser();
	const [errorMsg, setErrorMsg] = useState(null);
	const methods = useAppForm({
		defaultValues: EMPTY,
		values: data
			? {
					name: data.name ?? "",
					email: data.email ?? "",
					isAdmin: Boolean(isAdmin(data.roles)),
					isDisabled: Boolean(data.isDisabled),
				}
			: undefined,
		validate,
	});
	const { isSubmitting } = methods.formState;
	const onSubmit = async (values) => {
		setErrorMsg(null);
		try {
			// the own roles and disabled flag are never sent (no lock-out)
			await setUser(
				self
					? { id: "me", name: values.name, email: values.email }
					: {
							id: userId,
							name: values.name,
							email: values.email,
							roles: values.isAdmin ? ["admin"] : [],
							isDisabled: values.isDisabled,
						},
			);
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
						<AvatarRow id={userId} user={data} onError={setErrorMsg} />
						<TextField name="name" label={<T id="user.full-name" />} autoComplete="off" required />
						<TextField
							name="email"
							type="email"
							label={<T id="email-address" />}
							autoComplete="off"
							required
						/>
						{self ? null : (
							<FormSection legend={<T id="options" />} className="mb-0">
								<SwitchList>
									<SwitchField
										id="isAdmin"
										label={<T id="role.admin" />}
										{...methods.register("isAdmin")}
									/>
									<SwitchField
										id="isDisabled"
										label={<T id="disabled" />}
										{...methods.register("isDisabled")}
									/>
								</SwitchList>
							</FormSection>
						)}
					</>
				) : null}
			</AccountPart>
		</HookForm>
	);
}
