import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	define: {
		global: "globalThis",
	},
	resolve: {
		alias: {
			src: "/src",
			translations: "/translations",
			// Radix's scroll lock adds its styles with this package as a <style> element, which the CSP refuses: the same
			// API on constructed stylesheets
			"react-style-singleton": "/src/modules/StyleSingleton.js",
		},
	},
});
