export function EmailFormatter({ email }) {
	return (
		<a href={`mailto:${email}`} className="text-secondary">
			{email}
		</a>
	);
}
