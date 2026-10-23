import { intl, T } from "src/locale";

export function Loading({ label, noLogo }) {
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
				{/* Tabler sets img { height: auto }, so the width keeps the logo at 100px tall */}
				<img src="/images/logo-no-text.svg" width={87} height={100} alt="" />
			</div>
			<div className="text-secondary mb-3">{label || <T id="loading" />}</div>
			<div className="progress progress-sm" role="progressbar" aria-label={intl.formatMessage({ id: "loading" })}>
				<div className="progress-bar progress-bar-indeterminate" />
			</div>
		</div>
	);
}
