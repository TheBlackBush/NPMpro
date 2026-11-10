import { lazy, Suspense } from "react";
import EasyModal from "src/modules/easyModal";

// the window and the QR code library are a chunk of their own, loaded when the window first opens; the window
// records its opener here, before the chunk arrives
const MfaWindow = lazy(() => import("./MfaWindow"));

const MfaModal = EasyModal.create((props) => (
	<Suspense fallback={null}>
		<MfaWindow {...props} />
	</Suspense>
));

const showMfaModal = (id) => {
	EasyModal.show(MfaModal, { id });
};

export { showMfaModal };
