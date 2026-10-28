import { BreakableHost } from "./BreakableHost";

// a long address wraps after its @ and dots, so the users table fits a tablet
export function EmailFormatter({ email }) {
	return (
		<a href={`mailto:${email}`} className="text-secondary">
			<BreakableHost value={email} />
		</a>
	);
}
