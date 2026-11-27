import { Users } from "lucide-react";
import { useState } from "react";
import {
	ApiErrorContent,
	AppModal,
	Button,
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
import { DirtyTracker, useInvitationsOffered, useSetUser, useUnsavedChangesGuard, useUser } from "src/hooks";
import { intl, T } from "src/locale";
import { userValidate } from "src/modules/AccountForms";
import EasyModal from "src/modules/easyModal";
import { invitationFailureText } from "src/modules/InvitationMessages";
import { invitationOutcome, inviteOptionShown, userCreatePayload } from "src/modules/Invitations";
import { isAdmin } from "src/modules/Permissions";
import { validations } from "src/modules/Validations";
import { showError, showObjectSuccess, showSuccess } from "src/notifications";

/**
 * @param {number|string} id  a user's id, "new" or "me"
 */
const showUserModal = (id) => {
	EasyModal.show(UserModal, { id });
};

const validate = userValidate(validations);

const emptyUser = { name: "", email: "", isAdmin: false, isDisabled: false, invite: false };

const hasText = (messageId) => Boolean(intl.messages[messageId]);
const formatText = (messageId, values) => intl.formatMessage({ id: messageId }, values);

const UserModal = EasyModal.create(({ id, visible, remove }) => {
	const { dirtyRef, close } = useUnsavedChangesGuard(remove);
	const { data, isPending, error } = useUser(id);
	const { data: currentUser, isPending: currentIsPending } = useUser("me");
	const { mutateAsync: setUser } = useSetUser();
	const [errorMsg, setErrorMsg] = useState(null);
	const admin = isAdmin(currentUser?.roles) === true;
	const offered = useInvitationsOffered(admin);
	const inviteShown = inviteOptionShown({ offered, isAdmin: admin, isNew: id === "new" });
	const methods = useAppForm({
		defaultValues: emptyUser,
		values: data
			? {
					name: data.name ?? "",
					email: data.email ?? "",
					isAdmin: Boolean(isAdmin(data.roles)),
					isDisabled: Boolean(data.isDisabled),
					invite: false,
				}
			: undefined,
		validate,
	});
	const {
		register,
		formState: { isSubmitting },
	} = methods;
	const onSubmit = async (values) => {
		setErrorMsg(null);

		const payload = userCreatePayload(
			{
				id: id === "new" ? undefined : id,
				roles: [],
				...values,
			},
			inviteShown,
		);

		if (data?.id === currentUser?.id) {
			// Prevent user from locking themselves out
			delete payload.roles;
			delete payload.isDisabled;
		} else if (payload.isAdmin) {
			payload.roles = ["admin"];
		}

		// this isn't a real field, just for the form
		delete payload.isAdmin;

		try {
			const result = await setUser(payload);
			const outcome = payload.invite ? invitationOutcome(result) : null;
			showObjectSuccess("user", "saved");
			if (outcome?.sent === true) {
				showSuccess(<T id="user.invitation.sent" />);
			} else if (outcome) {
				showError(invitationFailureText(outcome, { created: true, format: formatText, has: hasText }));
			}
			remove();
		} catch (err) {
			setErrorMsg(<ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal show={visible} onHide={isSubmitting ? undefined : close} backdrop="static">
			{error && <ErrorAlert error={error} className="m-3" />}
			{(isPending || currentIsPending) && <Loading noLogo />}
			{data && currentUser && (
				<HookForm methods={methods} onSubmit={onSubmit}>
					<DirtyTracker dirtyRef={dirtyRef} />
					<AppModal.Header closeButton={!isSubmitting}>
						<AppModal.Title className="flex items-center gap-2">
							<Users className="size-5 shrink-0" aria-hidden="true" />
							<T id={data?.id ? "object.edit" : "object.add"} tData={{ object: "user" }} />
						</AppModal.Title>
					</AppModal.Header>
					<AppModal.Body>
						<ErrorAlert onClose={() => setErrorMsg(null)}>{errorMsg}</ErrorAlert>
						<TextField name="name" label={<T id="user.full-name" />} autoComplete="off" required />
						<TextField
							name="email"
							type="email"
							label={<T id="email-address" />}
							autoComplete="off"
							required
						/>
						{inviteShown ? (
							<FormSection legend={<T id="user.invite" />} hideLegend>
								<SwitchList>
									<SwitchField
										id="invite"
										label={<T id="user.invite" />}
										hint={<T id="user.invite.hint" />}
										{...register("invite")}
									/>
								</SwitchList>
							</FormSection>
						) : null}
						{currentUser?.id !== data?.id ? (
							<FormSection legend={<T id="options" />} className="mb-0">
								<SwitchList>
									<SwitchField id="isAdmin" label={<T id="role.admin" />} {...register("isAdmin")} />
									<SwitchField
										id="isDisabled"
										label={<T id="disabled" />}
										{...register("isDisabled")}
									/>
								</SwitchList>
							</FormSection>
						) : null}
					</AppModal.Body>
					<AppModal.Footer>
						<Button variant="ghost" onClick={close} disabled={isSubmitting}>
							<T id="cancel" />
						</Button>
						<FormSubmit
							className="ms-auto"
							edit={Boolean(data?.id)}
							isLoading={isSubmitting}
							disabled={isSubmitting}
						>
							<T id="save" />
						</FormSubmit>
					</AppModal.Footer>
				</HookForm>
			)}
		</AppModal>
	);
});

export { showUserModal };
