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
					{/* Tabler's .text-wrap is white-space: normal, which would collapse the nginx output */}
					<pre className="mb-0" style={{ whiteSpace: "pre-wrap" }}>
						{nginxErr || <T id="status.config-error.unknown" />}
					</pre>
				</Popover.Body>
			</Popover>
		);

		return (
			<OverlayTrigger trigger="click" placement="bottom" overlay={popover} rootClose>
				<button type="button" className="status status-red border-0">
					<span className="status-dot" />
					<T id="status.config-error" />
				</button>
			</OverlayTrigger>
		);
	}

	return (
		<span className={cn("status", enabled ? "status-lime" : "status-orange")}>
			<span className={cn("status-dot", enabled && "status-dot-animated")} />
			<T id={enabled ? "online" : "disabled"} />
		</span>
	);
}
