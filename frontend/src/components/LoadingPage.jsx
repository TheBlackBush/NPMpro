import { Loading } from "src/components";
import { cn } from "src/lib/utils";

/**
 * A centred loading indicator for a whole page.
 *
 * @param {Object}  props
 * @param {boolean} [props.fullScreen]  the full viewport height (the app start before the shell exists); without it
 *   the indicator fills a page area under the top bar
 */
export function LoadingPage({ label, noLogo, delay, fullScreen = false }) {
	return (
		<div
			className={cn(
				"flex items-center justify-center p-4",
				fullScreen ? "min-h-svh bg-muted/40" : "min-h-[50vh]",
			)}
		>
			<div className="w-full max-w-sm">
				<Loading label={label} noLogo={noLogo} delay={delay} />
			</div>
		</div>
	);
}
