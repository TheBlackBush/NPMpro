import { createContext, useContext, useEffect, useState } from "react";
import { resolveTheme, startPreference, THEME_KEY, THEME_RESET_KEY } from "src/modules/Theme";

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

const ThemeContext = createContext(undefined);

// localStorage can throw (blocked storage); the theme then lasts for the visit only
const readStorage = (key) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};
const writeStorage = (key, value) => {
	try {
		localStorage.setItem(key, value);
	} catch {
		// the choice lasts for this visit
	}
};

const systemDark = () => window.matchMedia(SYSTEM_DARK).matches;

/**
 * The colour theme: preference is the user's choice (light, dark or auto, the system's theme), theme the one it shows.
 * With auto the theme follows the system live (prefers-color-scheme).
 */
export const ThemeProvider = ({ children }) => {
	const [preference, setPreference] = useState(() =>
		startPreference(readStorage(THEME_KEY), readStorage(THEME_RESET_KEY)),
	);
	const [isSystemDark, setSystemDark] = useState(systemDark);
	const theme = resolveTheme(preference, isSystemDark);

	useEffect(() => {
		const query = window.matchMedia(SYSTEM_DARK);
		const onChange = (event) => setSystemDark(event.matches);
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	useEffect(() => {
		writeStorage(THEME_KEY, preference);
		writeStorage(THEME_RESET_KEY, "1");
	}, [preference]);

	useEffect(() => {
		for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
			meta.media = meta.dataset.theme === theme ? "all" : "not all";
	}, [theme]);

	document.documentElement.classList.toggle("dark", theme === "dark");
	return <ThemeContext.Provider value={{ theme, preference, setPreference }}>{children}</ThemeContext.Provider>;
};

export function useThemeState() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useThemeState must be used within a ThemeProvider");
	}
	return context;
}
