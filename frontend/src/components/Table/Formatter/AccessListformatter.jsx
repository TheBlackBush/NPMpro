import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Popover from "react-bootstrap/Popover";
import { intl } from "src/locale";
import { showAccessListModal, showProxyHostModal } from "src/modals";

export function AccessListFormatter({ proxyHostId, access, type, locations }) {
	const hasLocationAcls = locations.some((loc) => loc.accessLists.length > 0);

	let triggerLabel =
		type === "custom"
			? intl.formatMessage({ id: "access-list.custom" })
			: intl.formatMessage({ id: "access-list.public" });

	if (access.length === 1) {
		triggerLabel = access[0].name;
	}
	const popover = (
		<Popover id={`access-list-popover-${proxyHostId}`}>
			<Popover.Body>
				{access.map((acl) => (
					<div key={acl.id}>{acl.name}</div>
				))}
			</Popover.Body>
		</Popover>
	);

	const button = (
		<button
			type="button"
			className="btn btn-link d-inline-block p-0 border-0 text-decoration-none text-start align-baseline"
			// Tabler .btn sets a minimum size, which would centre and pad the text like a button
			style={{ minWidth: 0, minHeight: 0 }}
			aria-label={triggerLabel}
			onClick={(e) => {
				e.preventDefault();
				if (access.length === 1) {
					showAccessListModal(access[0].id);
				} else {
					showProxyHostModal(proxyHostId);
				}
			}}
		>
			{hasLocationAcls ? <strong>{triggerLabel}</strong> : triggerLabel}
		</button>
	);
	if (access.length > 1) {
		return (
			<OverlayTrigger trigger={["hover", "focus"]} placement="bottom" overlay={popover}>
				{button}
			</OverlayTrigger>
		);
	}
	return button;
}
