import { GlobeIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { TapTooltip } from "src/components/TapTooltip";
import { cn } from "src/lib/utils";

// One chunk per country: the flag's SVG text (country-flag-icons/string/3x2), fetched when the flag first shows.
// Two-letter codes only, the ones the package's React flags have. Those all live in one module, so importing one
// loads the whole set.
const FLAGS = import.meta.glob("/node_modules/country-flag-icons/string/3x2/[A-Z][A-Z].js", {
	import: "default",
	exhaustive: true,
});
const VIEW_BOX = "0 0 513 342";
const SVG = /^<svg[^>]*\sviewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/u;
// by code: { viewBox, body } once loaded, null for a text that did not parse
const loaded = new Map();

const loaderOf = (code) => FLAGS[`/node_modules/country-flag-icons/string/3x2/${code}.js`];

function useFlagSvg(code) {
	const [svg, setSvg] = useState(() => loaded.get(code));
	useEffect(() => {
		if (loaded.has(code)) {
			setSvg(loaded.get(code));
			return;
		}
		const load = loaderOf(code);
		if (!load) return;
		let current = true;
		load().then(
			(text) => {
				const match = SVG.exec(text);
				const value = match ? { viewBox: match[1], body: match[2] } : null;
				loaded.set(code, value);
				if (current) setSvg(value);
			},
			() => undefined,
		);
		return () => {
			current = false;
		};
	}, [code]);
	return svg;
}

function Flag({ className, countryCode, tooltip = true }) {
	const svg = useFlagSvg(countryCode);
	if (countryCode === "EN") {
		return <GlobeIcon className={cn("size-5", className)} aria-hidden="true" />;
	}

	// codes without a flag (unknown or reserved ones such as XK) render nothing instead of throwing
	if (!loaderOf(countryCode) || svg === null) {
		return null;
	}
	// a thin themable edge (the theme border colour), so a white flag (Japan) does not melt into a light background
	// the code in the themed tooltip (hover or focus; a tap on a flag does nothing else), the wrapper names the image
	// until the flag's file is there, an empty box of the same size holds its place
	const image = (
		<span role="img" aria-label={countryCode} className={cn("inline-flex", className)}>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox={svg?.viewBox ?? VIEW_BOX}
				aria-hidden="true"
				className="rounded-sm border"
				width={20}
				// biome-ignore lint/security/noDangerouslySetInnerHtml: the static SVG of an installed package, no user data
				dangerouslySetInnerHTML={svg ? { __html: svg.body } : undefined}
			/>
		</span>
	);
	// tooltip={false}: inside something that has its own tooltip (CountryName), so a label has just one
	return tooltip ? (
		<TapTooltip content={countryCode} tap={false}>
			{image}
		</TapTooltip>
	) : (
		image
	);
}

export { Flag };
