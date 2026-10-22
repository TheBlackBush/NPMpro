import cn from "clsx";

function Button({
	children,
	className,
	onClick,
	type,
	actionType,
	variant,
	size,
	color,
	fullWidth,
	isLoading,
	disabled,
	...rest
}) {
	const cns = cn(
		"btn",
		className,
		actionType && `btn-${actionType}`,
		variant && `btn-${variant}`,
		size && `btn-${size}`,
		color && `btn-${color}`,
		fullWidth && "w-100",
		isLoading && "btn-loading",
	);

	return (
		<button
			{...rest}
			type={type || "button"}
			className={cns}
			onClick={() => !isLoading && onClick?.()}
			disabled={disabled}
		>
			{children}
		</button>
	);
}

export { Button };
