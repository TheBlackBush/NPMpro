import express from "express";
import internalOidcSetting from "../internal/oidc-setting.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/settings/oidc
 */
router
	.route("/")
	.all(jwtdecode())

	/**
	 * GET /api/settings/oidc
	 *
	 * Effective OIDC settings (the client secret is never returned)
	 */
	.get(async (_, res) => {
		res.status(200).send(await internalOidcSetting.get(res.locals.access));
	})

	/**
	 * PUT /api/settings/oidc
	 *
	 * Save the OIDC settings
	 */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/oidc", "put"), req.body);
		res.status(200).send(await internalOidcSetting.update(res.locals.access, payload));
	});

/**
 * /api/settings/oidc/test
 */
router
	.route("/test")
	.all(jwtdecode())

	/**
	 * POST /api/settings/oidc/test
	 *
	 * Run discovery with the effective or the submitted connection values
	 */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/oidc/test", "post"), req.body ?? {});
		res.status(200).send(await internalOidcSetting.test(res.locals.access, payload));
	});

export default router;
