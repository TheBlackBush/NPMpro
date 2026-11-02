/**
 * react-style-singleton on constructed stylesheets (document.adoptedStyleSheets) instead of <style> elements. Radix's
 * scroll lock (react-remove-scroll, used by menus, dialogs and sheets) adds its styles through that package, and the
 * CSP (style-src-elem 'self' plus two hashes) refuses an inline <style>: the lock would fail and log a violation each
 * time a menu opens. A constructed stylesheet is no element, so the CSP allows it. vite.config.js points the
 * package's imports here; the exports and their behaviour are the package's: the first add() of a singleton adds its
 * styles, the last remove() takes them away.
 */
import { useEffect } from "react";

/**
 * @param   {Document} [doc]  the document (a test passes its own)
 * @returns {{ add: (style: string) => void, remove: () => void }}
 */
export const stylesheetSingleton = (doc) => {
	let counter = 0;
	let sheet = null;
	let target = null;
	return {
		add(style) {
			target = doc ?? globalThis.document;
			if (counter === 0 && target) {
				sheet = new target.defaultView.CSSStyleSheet();
				sheet.replaceSync(style);
				target.adoptedStyleSheets = [...target.adoptedStyleSheets, sheet];
			}
			counter++;
		},
		remove() {
			counter--;
			if (counter === 0 && sheet) {
				target.adoptedStyleSheets = target.adoptedStyleSheets.filter((item) => item !== sheet);
				sheet = null;
			}
		},
	};
};

/** A hook that adds styles while a component is mounted (react-style-singleton's styleHookSingleton) */
export const styleHookSingleton = () => {
	const sheet = stylesheetSingleton();
	return (styles, isDynamic) => {
		// biome-ignore lint/correctness/useExhaustiveDependencies: the package's own rule: static styles are added once, dynamic ones again when they change
		useEffect(() => {
			sheet.add(styles);
			return () => sheet.remove();
		}, [styles && isDynamic]);
	};
};

/** A component that adds its styles while mounted (react-style-singleton's styleSingleton) */
export const styleSingleton = () => {
	const useStyle = styleHookSingleton();
	// biome-ignore lint/correctness/noComponentHookFactories: the package's API returns a new component per singleton, made once at import
	const Sheet = ({ styles, dynamic }) => {
		useStyle(styles, dynamic);
		return null;
	};
	return Sheet;
};
