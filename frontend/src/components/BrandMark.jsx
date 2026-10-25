/**
 * The NPMpro mark in the colours of the current theme: the light file has a dark N, the dark file a white N.
 * Tabler shows one of the two images per theme, so the gradient stays in colour in dark mode.
 *
 * @param {Object}  props
 * @param {number}  props.size        width and height in pixels
 * @param {string}  [props.className] extra classes for both images
 */
export function BrandMark({ size, className = "" }) {
	const style = { width: `${size}px`, height: `${size}px` };
	return (
		<>
			<img
				src="/images/logo-mark-light.svg"
				width={size}
				height={size}
				className={`hide-theme-dark ${className}`.trim()}
				style={style}
				alt=""
			/>
			<img
				src="/images/logo-mark-dark.svg"
				width={size}
				height={size}
				className={`hide-theme-light ${className}`.trim()}
				style={style}
				alt=""
			/>
		</>
	);
}
