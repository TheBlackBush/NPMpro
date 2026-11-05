import { TriangleAlert } from "lucide-react";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "src/App.jsx";
import { Alert, AlertDescription } from "src/components/ui/alert";
import { resolveTheme, startPreference, THEME_KEY, THEME_RESET_KEY } from "src/modules/Theme";

import "src/styles/globals.css";

// first paint in the right theme; ThemeProvider takes over once React renders
try {
	const preference = startPreference(localStorage.getItem(THEME_KEY), localStorage.getItem(THEME_RESET_KEY));
	const dark = resolveTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches) === "dark";
	document.documentElement.classList.toggle("dark", dark);
} catch {
	// blocked storage: ThemeProvider applies the system theme on first render
}

const root = ReactDOM.createRoot(document.querySelector("#root"), {
	onUncaughtError: (error) =>
		root.render(
			<div className="flex min-h-svh items-center justify-center p-4">
				<div className="flex w-full max-w-md flex-col items-center gap-4">
					{/* data-error-page: the CSP gate's marker of an error page */}
					<div data-error-page className="flex size-20 items-center justify-center rounded-full bg-muted">
						<TriangleAlert aria-hidden="true" className="size-10 text-destructive" />
					</div>
					<Alert variant="destructive">
						<AlertDescription className="wrap-anywhere">{error?.message ?? String(error)}</AlertDescription>
					</Alert>
				</div>
			</div>,
		),
});

root.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
