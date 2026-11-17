import express from "express";
import internalApiToken from "../internal/api-token.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import pathId from "../lib/express/path-id.js";
import sessionOnly from "../lib/express/session-only.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router.param("token_id", pathId);

/**
 * /api/api-tokens: every token with its owner (administrators, signed-in session)
 */
router
	.route("/")
	.all(jwtdecode())
	.all(sessionOnly())

	/** GET /api/api-tokens */
	.get(async (_, res) => {
		res.status(200).send(await internalApiToken.listAll(res.locals.access));
	});

/**
 * /api/api-tokens/123
 */
router
	.route("/:token_id")
	.all(jwtdecode())
	.all(sessionOnly())

	/** DELETE /api/api-tokens/123 */
	.delete(async (req, res) => {
		res.status(200).send(await internalApiToken.revokeAny(res.locals.access, Number(req.params.token_id)));
	});

export default router;
