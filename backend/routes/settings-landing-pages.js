import express from "express";
import internalLandingPages from "../internal/landing-pages.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

/**
 * /api/settings/landing-pages
 */
const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

const idOf = (value) => (/^[0-9]{1,15}$/u.test(value) ? Number(value) : 0);
const sendPreview = (what) => async (req, res) => {
	const html = await internalLandingPages.preview(res.locals.access, what(req.params));
	res.status(200).type("html").send(html);
};

/** GET /api/settings/landing-pages/preview/...: nginx serves them with a sandboxed CSP (conf.d/npmpro.conf) */
router.get(
	"/preview/proxy-host/:id/:type",
	jwtdecode(),
	sendPreview(({ id, type }) => ({ source: "proxy-host", id: idOf(id), type })),
);
router.get(
	"/preview/dead-host/:id",
	jwtdecode(),
	sendPreview(({ id }) => ({ source: "dead-host", id: idOf(id) })),
);
router.get(
	"/preview/access-list/:id",
	jwtdecode(),
	sendPreview(({ id }) => ({ source: "access-list", id: idOf(id) })),
);
router.get(
	"/preview/:source/:type",
	jwtdecode(),
	sendPreview(({ source, type }) => ({ source, type })),
);

router
	.route("/")
	.all(jwtdecode())

	/** GET /api/settings/landing-pages */
	.get(async (_, res) => {
		res.status(200).send(await internalLandingPages.get(res.locals.access));
	})

	/** PUT /api/settings/landing-pages */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/landing-pages", "put"), req.body);
		res.status(200).send(await internalLandingPages.update(res.locals.access, payload));
	});

export default router;
