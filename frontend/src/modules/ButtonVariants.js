// Maps the props of the old Tabler button (colour, outline, size, Bootstrap classes) to shadcn Button variants.
// Pure functions, no React.

const DESTRUCTIVE_COLORS = new Set(["danger", "red"]);

// Bootstrap classes that only styled the old button: the shadcn variant and size replace them
const DROPPED = new Set([
	"btn",
	"btn-primary",
	"btn-secondary",
	"btn-danger",
	"btn-outline",
	"btn-action",
	"btn-ghost-secondary",
	"link-secondary",
	"dropdown-toggle",
]);

const BTN_SIZES = { "btn-sm": "sm", "btn-lg": "lg" };

// Bootstrap utilities without the same name in Tailwind
const TRANSLATED = {
	"d-inline-flex": "inline-flex",
	"d-inline-block": "inline-block",
	"d-flex": "flex",
	"d-block": "block",
	"w-100": "w-full",
	"text-start": "text-left",
	"text-end": "text-right",
	"text-reset": "text-inherit",
	"text-decoration-none": "no-underline",
	"align-items-center": "items-center",
	"flex-fill": "flex-1",
	"flex-md-grow-0": "md:grow-0",
};

const SPACING = { s: "l", e: "r" };
const START_END = /^(?<kind>[mp])(?<side>[se])-(?<value>.+)$/u;
const SPACES = /\s+/u;

const translateClass = (name) => {
	if (TRANSLATED[name]) return TRANSLATED[name];
	// ms-2 -> ml-2, me-auto -> mr-auto, ps-2 -> pl-2 (Bootstrap start/end spacing)
	const spacing = START_END.exec(name);
	if (spacing) return `${spacing.groups.kind}${SPACING[spacing.groups.side]}-${spacing.groups.value}`;
	return name;
};

// shadcn sizes of the old size names; a larger Tabler size than lg also becomes lg
const sizeOf = (size) => {
	if (!size) return "default";
	if (["sm", "lg", "icon", "icon-sm", "icon-lg"].includes(size)) return size;
	if (size === "xl") return "lg";
	return "default";
};

/**
 * @param {{ color?: string, outline?: boolean, size?: string, className?: string }} options
 * @returns {{ variant: string, size: string, rest: string }} `rest` is the className without the Bootstrap classes
 *   that became the variant or size, and with the remaining Bootstrap utilities translated to Tailwind
 */
const buttonVariant = ({ color, outline, size, className } = {}) => {
	const kept = [];
	let classVariant;
	let classSize;
	let icon = false;
	for (const name of (className ?? "").split(SPACES).filter(Boolean)) {
		if (name === "btn-link") classVariant = classVariant ?? "link";
		else if (name === "btn-ghost") classVariant = classVariant === "link" ? "link" : "ghost";
		else if (name === "btn-icon") icon = true;
		else if (BTN_SIZES[name]) classSize = BTN_SIZES[name];
		else if (!DROPPED.has(name)) kept.push(translateClass(name));
	}

	let variant;
	if (classVariant) variant = classVariant;
	else if (DESTRUCTIVE_COLORS.has(color)) variant = "destructive";
	else if (color === "secondary") variant = outline ? "outline" : "secondary";
	else if (!color || outline) variant = "outline";
	else variant = "default";

	let resolved = sizeOf(size ?? classSize);
	if (icon) resolved = resolved === "sm" || resolved === "lg" ? `icon-${resolved}` : "icon";

	return { variant, size: resolved, rest: kept.join(" ") };
};

export { buttonVariant };
