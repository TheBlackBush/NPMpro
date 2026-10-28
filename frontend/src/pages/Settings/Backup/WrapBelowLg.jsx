// below lg the content may wrap, so a table fits next to the settings menu on tablets; from lg it stays on one line
function WrapBelowLg({ children }) {
	return (
		<>
			<span className="d-lg-none">{children}</span>
			<span className="d-none d-lg-inline text-nowrap">{children}</span>
		</>
	);
}

export { WrapBelowLg };
