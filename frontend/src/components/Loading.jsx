import { Progress } from "src/components/ui/progress";
import { Spinner } from "src/components/ui/spinner";
import { useDelayElapsed } from "src/hooks";
import { intl, T } from "src/locale";
import { BrandMark } from "./BrandMark";

/**
 * With the logo: the logo, the label and the indeterminate brand bar (page loads). Without it: a spinner and the label
 * (loading inside a page, such as a table).
 *
 * @param {Object}  props
 * @param {number}  [props.delay]  render nothing for this many milliseconds, so fast loads do not flash a spinner
 */
export function Loading({ label, noLogo, delay = 0 }) {
	const visible = useDelayElapsed(delay);
	if (!visible) {
		return null;
	}
	if (noLogo) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
				<Spinner className="size-6" role="presentation" aria-hidden="true" />
				<p className="m-0 text-sm" role="status">
					{label || <T id="loading" />}
				</p>
			</div>
		);
	}
	return (
		<div className="flex flex-col items-center justify-center gap-4 p-6 text-center text-muted-foreground">
			<BrandMark size={100} />
			<p className="m-0 text-sm" role="status">
				{label || <T id="loading" />}
			</p>
			<Progress aria-label={intl.formatMessage({ id: "loading" })} className="max-w-48" />
		</div>
	);
}
