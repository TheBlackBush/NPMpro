import { KeyRound } from "lucide-react";
import { AppModal, Button, NoticeAlert } from "src/components";
import { CodeBox } from "src/components/CodeBox";
import { intl, T } from "src/locale";
import EasyModal from "src/modules/easyModal";

/**
 * The signing secret of a webhook, shown once after a create, a rotation or the save of a webhook restored without its
 * secrets. The window holds it in its props only: it is not stored anywhere and closing the window drops it.
 */
const showWebhookSecretModal = (name, secret) => {
	EasyModal.show(WebhookSecretModal, { name, secret });
};

const WebhookSecretModal = EasyModal.create(({ name, secret, visible, remove }) => (
	<AppModal size="md" show={visible} onHide={remove} backdrop="static">
		<AppModal.Header closeButton>
			<AppModal.Title className="flex items-center gap-2">
				<KeyRound className="size-5 shrink-0" aria-hidden="true" />
				<T id="settings.webhooks.secret.title" />
			</AppModal.Title>
		</AppModal.Header>
		<AppModal.Body>
			<p className="mb-3 wrap-anywhere">
				<T id="settings.webhooks.secret.intro" data={{ name }} />
			</p>
			{/* the box copies with the Clipboard API; where that is missing the text is selected for a manual copy */}
			<CodeBox
				text={secret}
				label={intl.formatMessage({ id: "settings.webhooks.secret.label" })}
				data-webhook-secret=""
				className="mb-3"
			/>
			<NoticeAlert>
				<T id="settings.webhooks.secret.once" />
			</NoticeAlert>
		</AppModal.Body>
		<AppModal.Footer>
			<Button color="primary" onClick={remove} className="ms-auto">
				<T id="settings.webhooks.secret.done" />
			</Button>
		</AppModal.Footer>
	</AppModal>
));

export { showWebhookSecretModal };
