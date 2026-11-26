import { Mail } from "lucide-react";
import { useState } from "react";
import {
	ApiErrorContent,
	AppModal,
	Button,
	ErrorAlert,
	FormSubmit,
	HookForm,
	TextField,
	useAppForm,
} from "src/components";
import { useSendTestMail } from "src/hooks";
import { T } from "src/locale";
import EasyModal from "src/modules/easyModal";
import { testMailValidate } from "src/modules/NotificationForms";
import { validations } from "src/modules/Validations";
import { showSuccess } from "src/notifications";

const showTestMailModal = (defaultTo) => {
	EasyModal.show(TestMailModal, { defaultTo });
};

const validate = (values) => {
	const id = testMailValidate(values.to);
	return id ? { to: validations.message(id) } : {};
};

/**
 * The window of "Send test mail": the address (the signed-in user's by default); the server's answer to a failed send
 * shows inside the window, a sent mail closes it with a toast
 */
const TestMailModal = EasyModal.create(({ defaultTo, visible, remove }) => {
	const { mutateAsync: send } = useSendTestMail();
	const [error, setError] = useState(null);
	const methods = useAppForm({ defaultValues: { to: defaultTo ?? "" }, validate });
	const { isSubmitting } = methods.formState;

	const onSubmit = async (values) => {
		setError(null);
		try {
			const to = values.to.trim();
			await send(to);
			showSuccess(<T id="settings.email.test.sent" data={{ to }} />);
			remove();
		} catch (err) {
			// the limiter answers 429 in English: show the translated text
			setError(err?.status === 429 ? <T id="error.too-many-requests" /> : <ApiErrorContent error={err} />);
		}
	};

	return (
		<AppModal size="sm" show={visible} onHide={isSubmitting ? undefined : remove} backdrop="static">
			<HookForm methods={methods} onSubmit={onSubmit}>
				<AppModal.Header closeButton={!isSubmitting}>
					<AppModal.Title className="flex items-center gap-2">
						<Mail className="size-5 shrink-0" aria-hidden="true" />
						<T id="settings.email.test.title" />
					</AppModal.Title>
				</AppModal.Header>
				<AppModal.Body>
					<ErrorAlert onClose={() => setError(null)}>{error}</ErrorAlert>
					<TextField
						name="to"
						id="test-mail-to"
						label={<T id="settings.email.test.to" />}
						hint={<T id="settings.email.test.to.hint" />}
						type="email"
						autoComplete="email"
						required
					/>
				</AppModal.Body>
				<AppModal.Footer>
					<Button variant="ghost" onClick={remove} disabled={isSubmitting}>
						<T id="cancel" />
					</Button>
					<FormSubmit isLoading={isSubmitting} disabled={isSubmitting}>
						<T id="settings.email.test.send" />
					</FormSubmit>
				</AppModal.Footer>
			</HookForm>
		</AppModal>
	);
});

export { showTestMailModal };
