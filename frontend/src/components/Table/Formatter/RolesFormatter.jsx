import { Badge } from "src/components/ui/badge";
import { T } from "src/locale";

// a role is a label, not a state: solid primary for admin, the neutral secondary look for the rest
export function RolesFormatter({ roles }) {
	return (
		<span className="inline-flex flex-wrap gap-1">
			{(roles.length ? roles : ["standard-user"]).map((role) => (
				<Badge key={role} variant={role === "admin" ? "default" : "secondary"}>
					<T id={`role.${role}`} />
				</Badge>
			))}
		</span>
	);
}
