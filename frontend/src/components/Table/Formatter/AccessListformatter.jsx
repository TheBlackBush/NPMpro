import { Tooltip, TooltipContent, TooltipTrigger } from "src/components/ui/tooltip";
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

	const button = (
		<button
			type="button"
			className="inline-block rounded-sm p-0 text-left align-baseline underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
			<Tooltip>
				<TooltipTrigger asChild>{button}</TooltipTrigger>
				<TooltipContent side="bottom" className="flex-col items-start gap-0.5">
					{access.map((acl) => (
						<div key={acl.id}>{acl.name}</div>
					))}
				</TooltipContent>
			</Tooltip>
		);
	}
	return button;
}
