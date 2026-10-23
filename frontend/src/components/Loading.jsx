import { useDelayElapsed } from "src/hooks";
import { intl, T } from "src/locale";

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
			<div className="empty-img navbar-brand-autodark">
				<img
					src="/images/logo-no-text.svg"
					width={87}
					height={100}
					className="navbar-brand-image"
					// navbar-brand-image turns the logo white in dark mode but caps the height at 2rem, sized for the navbar
					style={{ height: "100px" }}
					alt=""
				/>
			</div>
			<div className="text-secondary mb-3">{label || <T id="loading" />}</div>
			<div className="progress progress-sm" role="progressbar" aria-label={intl.formatMessage({ id: "loading" })}>
				<div className="progress-bar progress-bar-indeterminate" />
			</div>
		</div>
	);
}
