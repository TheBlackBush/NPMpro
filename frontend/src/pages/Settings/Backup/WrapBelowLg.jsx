// below lg the content may wrap, so a table fits next to the settings menu on tablets; from lg it stays on one line
function WrapBelowLg({ children }) {
	return (
		<>
			<span className="lg:hidden">{children}</span>
			<span className="hidden whitespace-nowrap lg:inline">{children}</span>
		</>
	);
}

export { WrapBelowLg };
