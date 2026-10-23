import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Popover from "react-bootstrap/Popover";
import { TrueFalseFormatter } from "src/components";
import { T } from "src/locale";

const getSection = (title, items) => {
	if (items.length === 0) {
		return null;
	}
	return (
		<>
			<div>
				<strong>
					<T id={title} />
				</strong>
			</div>
			{items.map((host) => (
				<div key={host.id} className="ms-1">
					{host.domainNames.join(", ")}
				</div>
			))}
		</>
	);
};

const getSectionStream = (items) => {
	if (items.length === 0) {
		return null;
	}
	return (
		<>
			<div>
				<strong>
					<T id="streams" />
				</strong>
			</div>
			{items.map((stream) => (
				<div key={stream.id} className="ms-1">
					{`${stream.forwardingHost}${stream.forwardingPort ? `:${stream.forwardingPort}` : ""}`}
				</div>
			))}
		</>
	);
};

export function CertificateInUseFormatter({ id, proxyHosts, redirectionHosts, deadHosts, streams }) {
	const totalCount = proxyHosts.length + redirectionHosts.length + deadHosts.length + streams.length;
	if (totalCount === 0) {
		return <TrueFalseFormatter value={false} falseLabel="certificate.not-in-use" falseColor="secondary" />;
	}

	const popover = (
		<Popover id={`popover-cert-in-use-${id}`}>
			<Popover.Body>
				{getSection("proxy-hosts", proxyHosts)}
				{getSection("redirection-hosts", redirectionHosts)}
				{getSection("dead-hosts", deadHosts)}
				{getSectionStream(streams)}
			</Popover.Body>
		</Popover>
	);

	return (
		<OverlayTrigger trigger={["hover", "click", "focus"]} placement="bottom" overlay={popover}>
			<button
				type="button"
				className="btn btn-link d-inline-block p-0 text-reset text-decoration-none text-start align-baseline"
				// Tabler .btn sets a minimum size, which would centre and pad the text like a button
				style={{ minWidth: 0, minHeight: 0 }}
			>
				<TrueFalseFormatter value trueLabel="certificate.in-use" />
			</button>
		</OverlayTrigger>
	);
}
