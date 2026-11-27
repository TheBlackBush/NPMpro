import { lazy, Suspense } from "react";
import EasyModal from "src/modules/easyModal";

// the window and its form load when the first one opens, so the Settings page stays small
const WebhookWindow = lazy(() => import("./WebhookWindow"));

/**
 * Add a webhook (null) or edit one (the row of the list)
 */
const showWebhookModal = (webhook) => {
	EasyModal.show(WebhookModal, { webhook });
};

const WebhookModal = EasyModal.create(({ webhook, visible, remove }) => (
	<Suspense fallback={null}>
		<WebhookWindow webhook={webhook} visible={visible} remove={remove} />
	</Suspense>
));

export { showWebhookModal };
