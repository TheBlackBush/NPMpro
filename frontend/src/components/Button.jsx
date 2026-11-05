import { TapTooltip } from "src/components/TapTooltip";
import { Button as UiButton } from "src/components/ui/button";
import { Spinner } from "src/components/ui/spinner";
import { cn } from "src/lib/utils";
import { buttonVariant } from "src/modules/ButtonVariants";

// The destructive look puts the red text on a light red tint: in light mode the token red reaches only about 4:1
// there, so the text is darkened like StatusBadge (7.2:1 on the tint, 6.0:1 on the hover tint); dark mode keeps the
// token (4.6:1 on the popover)
export const DESTRUCTIVE_TEXT = "text-[color-mix(in_oklab,var(--destructive)_75%,black)] dark:text-destructive";

/**
 * The app's button on the shadcn Button: colour, outline and size map to a variant (one primary colour; an
 * uncoloured button is the outline look).
 *
 * variant: a shadcn variant to use instead of the one color/outline map to (icon buttons: "ghost").
 *
 * title: the text of a themed tooltip (hover and keyboard focus only: the button keeps its own click, and the name
 * for assistive technology stays the caller's aria-label or text). Use it on a button that shows only an icon.
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
	variant: variantProp,
	title,
	...rest
}) {
	const { variant: mapped, size: uiSize } = buttonVariant({ color, outline, size });
	// an explicit shadcn variant (ghost) wins over the one the props map to
	const variant = variantProp ?? mapped;
	const button = (
		<UiButton
			{...rest}
			style={style}
			type={type || "button"}
			variant={variant}
			size={uiSize}
			className={cn(
				variant === "destructive" && DESTRUCTIVE_TEXT,
				className,
				fullWidth && "w-full",
				// the primary look has its own grey blocked state (ui/button.jsx); the others fade
				blocked && "aria-disabled:cursor-not-allowed",
				blocked && variant !== "default" && "aria-disabled:opacity-50",
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
	return title ? (
		<TapTooltip content={title} tap={false}>
			{button}
		</TapTooltip>
	) : (
		button
	);
}

export { Button };
