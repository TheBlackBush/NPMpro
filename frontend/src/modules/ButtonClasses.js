import cn from "clsx";

/**
 * Class list of a Tabler button: one colour (solid or outline), optional size, full width and loading state
 *
 * @param {{ color?: string, outline?: boolean, size?: string, fullWidth?: boolean, isLoading?: boolean, className?: string }} options
 * @returns {string}
 */
const buttonClassName = ({ color, outline, size, fullWidth, isLoading, className }) =>
	cn(
		"btn",
		color && (outline ? `btn-outline-${color}` : `btn-${color}`),
		size && `btn-${size}`,
		fullWidth && "w-100",
		isLoading && "btn-loading",
		className,
	);

export { buttonClassName };
