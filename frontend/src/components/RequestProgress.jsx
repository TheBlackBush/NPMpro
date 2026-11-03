import { Progress } from "src/components/ui/progress";
import { useElapsed } from "src/hooks/useElapsed";
import { cn } from "src/lib/utils";
import { intl, T } from "src/locale";
import { formatElapsed } from "src/modules/Duration";

/**
 * The wait of a request that takes long (a certificate request): the status text, the elapsed time, the DNS
 * propagation wait and an indeterminate bar in the brand gradient (static for people who reduce motion). Screen
 * readers get the status text (role status) and the bar as a progressbar without a value.
 *
 * @param {Object}  props
 * @param {boolean} props.running
 * @param {number}  [props.propagationSeconds]
 * @param {string}  [props.className]
 */
function RequestProgress({ running, propagationSeconds, className }) {
	const elapsed = useElapsed(running);
	if (!running) return null;
	const wait = Number(propagationSeconds);

	return (
		<div className={cn("mt-3", className)}>
			<div className="mb-2 text-muted-foreground">
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
			<Progress aria-label={intl.formatMessage({ id: "loading" })} className="h-1.5" />
		</div>
	);
}

export { RequestProgress };
