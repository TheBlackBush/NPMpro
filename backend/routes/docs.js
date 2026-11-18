import { fileURLToPath } from "node:url";
import express from "express";
import swaggerUi from "swagger-ui-express";
import { docsPage, FONT_FILES } from "../lib/docs-page.js";
import errs from "../lib/error.js";
import requireLogin from "../lib/express/require-login.js";
import PACKAGE from "../package.json" with { type: "json" };
import { getCompiledSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router.use("/", requireLogin());

// the NPMpro theme of the page: its stylesheet, the theme switch and the fonts
router.get("/npmpro/fonts/:file", (req, res, next) => {
	const file = FONT_FILES.get(req.params.file);
	if (!file) return next(new errs.ItemNotFoundError(req.params.file));
	// dotfiles allowed: the package path runs through pnpm's .pnpm folder
	res.type("font/woff2").sendFile(file, { dotfiles: "allow" });
});
router.use("/npmpro", express.static(fileURLToPath(new URL("../docs-theme/", import.meta.url)), { index: false }));

router.use("/", swaggerUi.serve);

router
	.route("/")

	/**
	 * GET / (the Swagger UI page)
	 */
	.get(async (req, res) => {
		const schema = await getCompiledSchema();
		// a copy: the cached schema also serves validation and /schema
		const spec = {
			...schema,
			info: { ...schema.info, version: PACKAGE.version },
			servers: [{ url: `${req.protocol}://${req.host}/api` }],
		};
		res.status(200).send(docsPage(spec));
	});

export default router;
