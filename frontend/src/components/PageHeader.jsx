function PageHeader({ title, pretitle, actions }) {
	return (
		<div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
			<div className="min-w-0">
				{pretitle ? (
					<div className="text-xs font-medium text-muted-foreground uppercase">{pretitle}</div>
				) : null}
				<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
			</div>
			{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
		</div>
	);
}

export { PageHeader };
