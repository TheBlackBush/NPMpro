import cn from "clsx";
import { T } from "src/locale";

export function RolesFormatter({ roles }) {
	return (
		<>
			{(roles.length ? roles : ["standard-user"]).map((role) => (
				<span key={role} className={cn("badge me-1", role === "admin" ? "bg-blue-lt" : "bg-secondary-lt")}>
					<T id={`role.${role}`} />
				</span>
			))}
		</>
	);
}
