import React from "react";
import ReactDOM from "react-dom/client";
import App from "src/App.jsx";
import { Page } from "src/components";
import { resolveTheme, startPreference, THEME_KEY, THEME_RESET_KEY } from "src/modules/Theme";

import "@tabler/core";
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
			<Page className="page-center">
				<div className="container-tight py-4">
					<div className="empty">
						<div className="empty-img">
							<img src="/images/unhealthy.svg" alt="" />
						</div>
						<div className="alert alert-danger text-break text-start w-100 mb-0">
							{error?.message ?? String(error)}
						</div>
					</div>
				</div>
			</Page>,
		),
});

root.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>,
);
