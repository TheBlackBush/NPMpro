import cn from "clsx";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Popover from "react-bootstrap/Popover";
import { T } from "src/locale";

export function StatusFormatter({ enabled, nginxOnline, nginxErr }) {
	if (enabled && !nginxOnline) {
		const popover = (
			<Popover id="popover-nginx-error">
				<Popover.Header>
					<T id="notification.nginx-config-error" />
				</Popover.Header>
				<Popover.Body>
					<pre className="mb-0 text-wrap">{nginxErr || <T id="status.config-error.unknown" />}</pre>
				</Popover.Body>
			</Popover>
		);

		return (
			<OverlayTrigger trigger="click" placement="bottom" overlay={popover} rootClose>
				<button type="button" className="status status-red border-0">
					<span className="status-dot status-dot-animated" />
					<T id="status.config-error" />
				</button>
			</OverlayTrigger>
		);
	}

	return (
		<span className={cn("status", enabled ? "status-lime" : "status-orange")}>
			<span className="status-dot status-dot-animated" />
			<T id={enabled ? "online" : "disabled"} />
		</span>
	);
}
