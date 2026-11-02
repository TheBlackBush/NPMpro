import { Loading } from "src/components";

export function LoadingPage({ label, noLogo, delay }) {
	return (
		<div className="flex min-h-svh items-center justify-center p-4">
			<div className="w-full max-w-sm">
				<Loading label={label} noLogo={noLogo} delay={delay} />
			</div>
		</div>
	);
}
