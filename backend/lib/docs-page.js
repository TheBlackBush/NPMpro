import { fileURLToPath } from "node:url";
import swaggerUi from "swagger-ui-express";

// Swagger UI options: no Swagger top bar (the NPMpro header replaces it), operations closed, a tag filter, the request
// time, nothing fetched from swagger.io, and a token from Authorize kept only until the page reloads
const SWAGGER_OPTIONS = Object.freeze({
	layout: "BaseLayout",
	docExpansion: "none",
	filter: true,
	displayRequestDuration: true,
	persistAuthorization: false,
	tryItOutEnabled: false,
	defaultModelsExpandDepth: -1,
	validatorUrl: null,
});

const font = (spec) => fileURLToPath(import.meta.resolve(spec));
// the Latin files only: the reference is English (the app's Greek and Cyrillic files stay in the frontend)
const FONT_FILES = new Map([
	["geist-latin.woff2", font("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2")],
	["geist-latin-ext.woff2", font("@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2")],
	["geist-mono-latin.woff2", font("@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2")],
	[
		"geist-mono-latin-ext.woff2",
		font("@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2"),
	],
]);

// in the head, so the first paint has the theme; files from 'self' (the page CSP allows no inline style or script)
const HEAD = '<link rel="stylesheet" href="./npmpro/docs.css"><script src="./npmpro/theme.js"></script>';
const logo = (theme) => `<img class="npmpro-logo-${theme}" src="/images/logo-horizontal-${theme}.svg" alt="NPMpro">`;
const HEADER = [
	'<header class="npmpro-docs-header">',
	'<a class="npmpro-docs-brand" href="/">',
	logo("light"),
	logo("dark"),
	"</a>",
	'<span class="npmpro-docs-title">API reference</span>',
	'<a class="npmpro-docs-back" href="/">Back to NPMpro</a>',
	"</header>",
].join("");

/**
 * The API reference page: Swagger UI's HTML with the NPMpro theme in the head and the NPMpro header
 *
 * @param   {Object} spec  the compiled OpenAPI schema
 * @returns {string}
 */
const docsPage = (spec) =>
	swaggerUi
		.generateHTML(spec, {
			customSiteTitle: "NPMpro API",
			customfavIcon: "/images/favicon/favicon.svg",
			swaggerOptions: SWAGGER_OPTIONS,
		})
		.replace("</head>", `${HEAD}</head>`)
		.replace('<div id="swagger-ui"></div>', `${HEADER}<div id="swagger-ui"></div>`);

export { docsPage, FONT_FILES, SWAGGER_OPTIONS };
