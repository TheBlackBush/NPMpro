import cn from "clsx";
import { buttonClassName } from "src/modules/ButtonClasses";
import { buttonLabelStyle } from "src/modules/SectionColors";

/**
 * blocked: looks disabled and does nothing when clicked, but stays focusable and announced (aria-disabled), so its
 * reason (aria-describedby) can be reached; use it when the button waits for the user to fix something, disabled
 * when it is simply not available; onBlockedClick runs instead of onClick while blocked. A colour whose white label
 * is hard to read gets a dark one (SectionColors.js).
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
	onBlockedClick,
	style,
	...rest
}) {
	const labelStyle = buttonLabelStyle(color);
	return (
		<button
			{...rest}
			style={labelStyle ? { ...labelStyle, ...style } : style}
			type={type || "button"}
			className={buttonClassName({
				color,
				outline,
				size,
				fullWidth,
				isLoading,
				// the disabled look, but still clickable (to show what to fix) with a not-allowed cursor
				className: cn(className, blocked && "disabled pe-auto cursor-not-allowed"),
			})}
			onClick={(e) => {
				if (blocked) {
					// also stops the form submit of a submit button (keyboard activation ignores pointer-events)
					e.preventDefault();
					onBlockedClick?.(e);
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
