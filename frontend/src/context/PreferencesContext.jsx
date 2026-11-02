import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
	EDITOR_KEY,
	NAV_KEY,
	parseCollapsed,
	parseEditorStyle,
	parseNavLayout,
	SIDEBAR_KEY,
} from "src/modules/Preferences";

const PreferencesContext = createContext(undefined);

// localStorage can throw (blocked storage); a choice then lasts for the visit only
const read = (key) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};
const write = (key, value) => {
	try {
		localStorage.setItem(key, value);
	} catch {
		// the choice lasts for this visit
	}
};

const flag = (value) => (value ? "1" : "0");

function useStored(key, parse, serialize = String) {
	const [value, setValue] = useState(() => parse(read(key)));
	const set = useCallback(
		(next) => {
			setValue(next);
			write(key, serialize(next));
		},
		[key, serialize],
	);
	return [value, set];
}

export function PreferencesProvider({ children }) {
	const [navLayout, setNavLayout] = useStored(NAV_KEY, parseNavLayout);
	const [editorStyle, setEditorStyle] = useStored(EDITOR_KEY, parseEditorStyle);
	const [sidebarCollapsed, setSidebarCollapsed] = useStored(SIDEBAR_KEY, parseCollapsed, flag);
	const value = useMemo(
		() => ({ navLayout, setNavLayout, editorStyle, setEditorStyle, sidebarCollapsed, setSidebarCollapsed }),
		[navLayout, setNavLayout, editorStyle, setEditorStyle, sidebarCollapsed, setSidebarCollapsed],
	);
	return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
	const context = useContext(PreferencesContext);
	if (!context) throw new Error("usePreferences must be used within a PreferencesProvider");
	return context;
}
