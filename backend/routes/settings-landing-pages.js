import express from "express";
import internalLandingPages from "../internal/landing-pages.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

/**
 * /api/settings/landing-pages
 */
const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

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
