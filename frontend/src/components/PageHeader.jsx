function PageHeader({ title, pretitle, actions }) {
	return (
		<div className="page-header d-print-none mt-0 mb-3">
			<div className="row g-2 align-items-center">
				<div className="col">
					{pretitle ? <div className="page-pretitle">{pretitle}</div> : null}
					<h2 className="page-title">{title}</h2>
				</div>
				{actions ? (
					<div className="col-auto ms-auto d-print-none">
						<div className="btn-list">{actions}</div>
					</div>
				) : null}
			</div>
		</div>
	);
}

export { PageHeader };
