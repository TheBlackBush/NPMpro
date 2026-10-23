import { useElapsed } from "src/hooks/useElapsed";
import { intl, T } from "src/locale";
import { formatElapsed } from "src/modules/Duration";

function RequestProgress({ running, propagationSeconds }) {
	const elapsed = useElapsed(running);
	if (!running) return null;
	const wait = Number(propagationSeconds);

	return (
		<div className="mt-3">
			<div className="text-secondary mb-2">
				<span role="status">
					<T id="certificates.request.status" />
				</span>
				<span className="ms-1" aria-hidden="true">
					<T id="certificates.request.progress" data={{ elapsed: formatElapsed(elapsed) }} />
					{wait > 0 ? (
						<>
							{" "}
							<T id="certificates.request.propagation" data={{ seconds: wait }} />
						</>
					) : null}
				</span>
			</div>
			<div className="progress progress-sm" role="progressbar" aria-label={intl.formatMessage({ id: "loading" })}>
				<div className="progress-bar progress-bar-indeterminate" />
			</div>
		</div>
	);
}

export { RequestProgress };
