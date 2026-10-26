import cn from "clsx";
import { buttonClassName } from "src/modules/ButtonClasses";

/**
 * blocked: looks disabled and does nothing when clicked, but stays focusable and announced (aria-disabled), so its
 * reason (aria-describedby) can be reached; use it when the button waits for the user to fix something, disabled
 * when it is simply not available
 */
function Button({
	children,
	className,
	onClick,
	type,
	color,
	outline,
	size,
	fullWidth,
	isLoading,
	disabled,
	blocked,
	...rest
}) {
	return (
		<button
			{...rest}
			type={type || "button"}
			className={buttonClassName({
				color,
				outline,
				size,
				fullWidth,
				isLoading,
				className: cn(className, blocked && "disabled"),
			})}
			onClick={(e) => {
				if (blocked) {
					// also stops the form submit of a submit button (keyboard activation ignores pointer-events)
					e.preventDefault();
					return;
				}
				if (!isLoading) onClick?.(e);
			}}
			disabled={disabled}
			aria-disabled={blocked || undefined}
			aria-busy={isLoading || undefined}
		>
			{children}
		</button>
	);
}

export { Button };
