export function SiteContainer({ children }) {
	return (
		<div className="page-wrapper">
			<main className="page-body">
				<div className="container-xl">{children}</div>
			</main>
		</div>
	);
}
