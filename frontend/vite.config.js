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
		},
	},
});
