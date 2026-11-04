import { cn } from "src/lib/utils";

// Width per 1 of height, from the viewBox of each artwork (icon 512x512, horizontal 1250x512, stacked 640x640)
const ASPECT = { icon: 1, horizontal: 1250 / 512, stacked: 1 };
const FILE = { icon: "logo-mark", horizontal: "logo-horizontal", stacked: "logo-stacked" };

/**
 * The NPMpro logo in the colours of the current theme: the light files have a dark N and name, the dark files a
 * white one. One of the two images shows per theme (dark: classes), so the gradient stays in colour in dark mode.
 *
 * @param {Object}  props
 * @param {"icon"|"horizontal"|"stacked"}  [props.variant]  the icon alone, or the icon with the name beside or below it
 * @param {number}  props.size        height in pixels (the width follows the artwork)
 * @param {string}  [props.alt]       text alternative; empty when the name is written next to the logo
 * @param {string}  [props.className] extra classes for both images
 */
export function BrandMark({ variant = "icon", size, alt = "", className = "" }) {
	const width = Math.round(size * ASPECT[variant]);
	return (
		<>
			<img
				src={`/images/${FILE[variant]}-light.svg`}
				width={width}
				height={size}
				className={cn("block dark:hidden", className)}
				alt={alt}
			/>
			<img
				src={`/images/${FILE[variant]}-dark.svg`}
				width={width}
				height={size}
				className={cn("hidden dark:block", className)}
				alt={alt}
			/>
		</>
	);
}
