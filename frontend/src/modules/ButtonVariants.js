// Maps the colour, outline and size props of the app's Button to shadcn Button variants. Pure functions, no React.

const DESTRUCTIVE_COLORS = new Set(["danger", "red"]);

// shadcn sizes of the size names callers pass; xl becomes lg
const sizeOf = (size) => {
	if (!size) return "default";
	if (["sm", "lg", "icon", "icon-sm", "icon-lg"].includes(size)) return size;
	if (size === "xl") return "lg";
	return "default";
};

/**
 * @param {{ color?: string, outline?: boolean, size?: string }} options
 * @returns {{ variant: string, size: string }}
 */
const buttonVariant = ({ color, outline, size } = {}) => {
	let variant;
	if (DESTRUCTIVE_COLORS.has(color)) variant = "destructive";
	else if (color === "secondary") variant = outline ? "outline" : "secondary";
	else if (!color || outline) variant = "outline";
	else variant = "default";
	return { variant, size: sizeOf(size) };
};

export { buttonVariant };
