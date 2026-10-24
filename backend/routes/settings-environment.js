import express from "express";
import internalEnvironment from "../internal/environment.js";
import jwtdecode from "../lib/express/jwt-decode.js";

/**
 * /api/settings/environment
 */
const environmentRouter = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

environmentRouter
	.route("/")
	.all(jwtdecode())

	/**
	 * GET /api/settings/environment
	 */
	.get(async (_, res) => {
		res.status(200).send(await internalEnvironment.get(res.locals.access));
	});

export default environmentRouter;
