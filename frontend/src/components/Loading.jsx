import { intl, T } from "src/locale";

export function Loading({ label, noLogo }) {
	if (noLogo) {
		return (
			<div className="empty">
				<div
					className="spinner-border text-secondary"
					role="status"
					aria-label={intl.formatMessage({ id: "loading" })}
				/>
				<p className="empty-subtitle text-secondary mt-3">{label || <T id="loading" />}</p>
			</div>
		);
	}
	return (
		<div className="empty">
			<div className="mb-3">
				<img src="/images/logo-no-text.svg" height="100" alt="" />
			</div>
			<div className="text-secondary mb-3">{label || <T id="loading" />}</div>
			<div className="progress progress-sm" role="progressbar" aria-label={intl.formatMessage({ id: "loading" })}>
				<div className="progress-bar progress-bar-indeterminate" />
			</div>
		</div>
	);
}
