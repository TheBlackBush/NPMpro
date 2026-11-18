// The app's colour theme on the API reference, as frontend/src/modules/Theme.js decides it: the stored choice
// (localStorage tabler-theme: light, dark or auto) once the one-time reset to System ran (npmpro-theme-system),
// the system's theme otherwise. html.dark-mode is Swagger UI's own dark theme. Loaded in the head for the first
// paint; follows a change in another tab and of the system theme.
(() => {
	const system = globalThis.matchMedia("(prefers-color-scheme: dark)");
	const read = (key) => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const apply = () => {
		const choice = read("npmpro-theme-system") ? read("tabler-theme") : null;
		const dark = choice === "dark" || (choice !== "light" && system.matches);
		document.documentElement.classList.toggle("dark-mode", dark);
	};
	apply();
	system.addEventListener("change", apply);
	globalThis.addEventListener("storage", (event) => {
		if ([null, "tabler-theme", "npmpro-theme-system"].includes(event.key)) apply();
	});
})();
