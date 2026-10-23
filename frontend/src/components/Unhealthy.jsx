import { Page } from "src/components";
import { T } from "src/locale";

export function Unhealthy() {
	return (
		<Page className="page-center">
			<div className="container-tight py-4">
				<div className="empty">
					<div className="empty-img">
						<img src="/images/unhealthy.svg" alt="" />
					</div>
					<p className="empty-title">
						<T id="unhealthy.title" />
					</p>
					<p className="empty-subtitle text-secondary">
						<T id="unhealthy.content" />
					</p>
					<div className="empty-action">
						<button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
							<T id="unhealthy.reload" />
						</button>
					</div>
				</div>
			</div>
		</Page>
	);
}
