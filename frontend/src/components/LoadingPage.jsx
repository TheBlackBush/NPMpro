import { Loading, Page } from "src/components";

export function LoadingPage({ label, noLogo, delay }) {
	return (
		<Page className="page-center">
			<div className="container-tight py-4">
				<Loading label={label} noLogo={noLogo} delay={delay} />
			</div>
		</Page>
	);
}
