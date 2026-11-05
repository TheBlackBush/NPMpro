import { Progress } from "src/components/ui/progress";
import { useDelayElapsed } from "src/hooks";
import { intl, T } from "src/locale";
import { BrandMark } from "./BrandMark";

/**
 * The label and the indeterminate brand bar; with the logo above them for whole-page loads, without it (noLogo) for
 * loading inside a page or a dialog.
 *
 * @param {Object}  props
 * @param {number}  [props.delay]  render nothing for this many milliseconds, so fast loads do not flash the indicator
 */
export function Loading({ label, noLogo, delay = 0 }) {
	const visible = useDelayElapsed(delay);
	if (!visible) {
		return null;
	}
	return (
		<div className="flex flex-col items-center justify-center gap-4 p-6 text-center text-muted-foreground">
			{noLogo ? null : <BrandMark size={100} />}
			<p className="m-0 text-sm" role="status">
				{label || <T id="loading" />}
			</p>
			<Progress
				aria-label={intl.formatMessage({ id: "loading" })}
				className={noLogo ? "h-1.5 max-w-48" : "h-1.5 max-w-64"}
			/>
		</div>
	);
}
