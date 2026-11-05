// the content may wrap while its table is narrow (the table's container is under 56rem), so a table fits in the
// section column next to the sidebar; wider it stays on one line
function WrapBelowLg({ children }) {
	return (
		<>
			<span className="@4xl:hidden">{children}</span>
			<span className="hidden whitespace-nowrap @4xl:inline">{children}</span>
		</>
	);
}

export { WrapBelowLg };
