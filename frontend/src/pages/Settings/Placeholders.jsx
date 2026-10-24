import { IconTools } from "@tabler/icons-react";
import { T } from "src/locale";

// Shown until the section is built
function Placeholder({ labelKey }) {
	return (
		<div className="card-body">
			<h2 className="mb-3">
				<T id={labelKey} />
			</h2>
			<div className="empty">
				<div className="empty-icon">
					<IconTools className="icon" aria-hidden="true" />
				</div>
				<p className="empty-title">
					<T id="settings.coming-soon" />
				</p>
				<p className="empty-subtitle text-secondary">
					<T id="settings.coming-soon.hint" />
				</p>
			</div>
		</div>
	);
}

const Certificates = () => <Placeholder labelKey="settings.certificates" />;
const Network = () => <Placeholder labelKey="settings.network" />;
const ForwardAuth = () => <Placeholder labelKey="settings.forward-auth" />;
const Advanced = () => <Placeholder labelKey="settings.advanced" />;
const Environment = () => <Placeholder labelKey="settings.environment" />;

export { Advanced, Certificates, Environment, ForwardAuth, Network };
