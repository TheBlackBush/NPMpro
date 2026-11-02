import { Button as UiButton } from "src/components/ui/button";
import { Spinner } from "src/components/ui/spinner";
import { cn } from "src/lib/utils";
import { buttonVariant } from "src/modules/ButtonVariants";

/**
 * The button of the old pages on the shadcn Button: colour, outline, size and Bootstrap classes are mapped by
 * buttonVariant (one primary colour; an uncoloured button is the outline look).
 *
 * blocked: looks disabled and does nothing when clicked, but stays focusable and announced (aria-disabled), so its
 * reason (aria-describedby) can be reached; use it when the button waits for the user to fix something, disabled
 * when it is simply not available; onBlockedClick runs instead of onClick while blocked.
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
	const { variant, size: uiSize, rest: classes } = buttonVariant({ color, outline, size, className });
	return (
		<UiButton
			{...rest}
			style={style}
			type={type || "button"}
			variant={variant}
			size={uiSize}
			className={cn(
				classes,
				fullWidth && "w-full",
				blocked && "aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
			)}
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
			{isLoading ? <Spinner role="presentation" aria-hidden="true" data-icon="inline-start" /> : null}
			{children}
		</UiButton>
	);
}

export { Button };
