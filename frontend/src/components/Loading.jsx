import { useDelayElapsed } from "src/hooks";
import { intl, T } from "src/locale";
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
	if (noLogo) {
		return (
			<div className="empty">
				<div className="spinner-border text-secondary" aria-hidden="true" />
				<p className="empty-subtitle text-secondary mt-3" role="status">
					{label || <T id="loading" />}
				</p>
			</div>
		);
	}
	return (
		<div className="empty">
			<div className="empty-img">
				<BrandMark size={100} />
			</div>
			<div className="text-secondary mb-3">{label || <T id="loading" />}</div>
			<div
				className="progress progress-sm progress-brand"
				role="progressbar"
				aria-label={intl.formatMessage({ id: "loading" })}
			>
				<div className="progress-bar progress-bar-indeterminate" />
			</div>
		</div>
	);
}
