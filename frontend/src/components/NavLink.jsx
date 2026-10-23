import cn from "clsx";
import { useNavigate } from "react-router";

export function NavLink({ children, to, href, isDropdownItem, active, className, onClick }) {
	const navigate = useNavigate();

	if (href) {
		return (
			<a
				className={cn(isDropdownItem ? "dropdown-item" : "nav-link", className)}
				href={href}
				target="_blank"
				rel="noopener noreferrer"
				onClick={onClick}
			>
				{children}
			</a>
		);
	}

	return (
		<a
			className={cn(isDropdownItem ? "dropdown-item" : "nav-link", { active }, className)}
			href={to}
			aria-current={active ? "page" : undefined}
			onClick={(e) => {
				e.preventDefault();
				if (onClick) {
					onClick();
				}
				void navigate(to);
			}}
		>
			{children}
		</a>
	);
}
