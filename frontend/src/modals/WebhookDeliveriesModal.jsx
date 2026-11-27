import { lazy, Suspense } from "react";
import EasyModal from "src/modules/easyModal";

// the window loads when the first one opens, so the Settings page stays small
const WebhookDeliveriesWindow = lazy(() => import("./WebhookDeliveriesWindow"));

/**
 * The deliveries of a webhook (the row of the list)
 */
const showWebhookDeliveriesModal = (webhook) => {
	EasyModal.show(WebhookDeliveriesModal, { webhook });
};

const WebhookDeliveriesModal = EasyModal.create(({ webhook, visible, remove }) => (
	<Suspense fallback={null}>
		<WebhookDeliveriesWindow webhook={webhook} visible={visible} remove={remove} />
	</Suspense>
));

export { showWebhookDeliveriesModal };
