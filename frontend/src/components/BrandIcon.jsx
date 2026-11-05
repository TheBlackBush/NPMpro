// A Simple Icons logo ({ title, path, hex }) in the text colour, so it contrasts with any button colour
function BrandIcon({ icon, className }) {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
			<path d={icon.path} />
		</svg>
	);
}

export { BrandIcon };
