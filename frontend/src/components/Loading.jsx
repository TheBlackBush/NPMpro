import { Spinner } from "src/components/ui/spinner";
import { useDelayElapsed } from "src/hooks";
import { T } from "src/locale";
import { BrandMark } from "./BrandMark";

/**
 * @param {Object}  props
 * @param {number}  [props.delay]  render nothing for this many milliseconds, so fast loads do not flash a spinner
 */
export function Loading({ label, noLogo, delay = 0 }) {
	const visible = useDelayElapsed(delay);
	if (!visible) {
		return null;
	}
	return (
		<div className="flex flex-col items-center justify-center gap-3 p-6 text-center text-muted-foreground">
			{noLogo ? null : <BrandMark size={100} />}
			<Spinner className="size-6" role="presentation" aria-hidden="true" />
			<p className="m-0 text-sm" role="status">
				{label || <T id="loading" />}
			</p>
		</div>
	);
}
