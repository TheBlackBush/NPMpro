import { useElapsed } from "src/hooks/useElapsed";
import { T } from "src/locale";
import { formatElapsed } from "src/modules/Duration";

function RequestProgress({ running, propagationSeconds }) {
	const elapsed = useElapsed(running);
	if (!running) return null;
	const wait = Number(propagationSeconds);

	return (
		<div className="text-secondary px-3 pb-3 d-flex align-items-center" role="status">
			<span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />
			<span>
				<T id="certificates.request.progress" data={{ elapsed: formatElapsed(elapsed) }} />
				{wait > 0 ? (
					<>
						{" "}
						<T id="certificates.request.propagation" data={{ seconds: wait }} />
					</>
				) : null}
			</span>
		</div>
	);
}

export { RequestProgress };
