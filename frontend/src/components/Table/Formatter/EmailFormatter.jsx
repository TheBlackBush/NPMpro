import { BreakableHost } from "./BreakableHost";

// a long address wraps after its @ and dots, so the users table fits a tablet
export function EmailFormatter({ email }) {
	return (
		<a href={`mailto:${email}`} className="break-words text-muted-foreground underline-offset-4 hover:underline">
			<BreakableHost value={email} />
		</a>
	);
}
