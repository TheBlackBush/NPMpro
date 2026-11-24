import express from "express";
import internalDnsCheck from "../../internal/dns-check.js";
import jwtdecode from "../../lib/express/jwt-decode.js";
import apiValidator from "../../lib/validator/api.js";
import { getValidationSchema } from "../../schema/index.js";

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

/**
 * /api/nginx/dns-check/hosts
 */
router
	.route("/hosts")
	.all(jwtdecode())
	.get(async (_req, res) => {
		res.status(200).send(await internalDnsCheck.hosts(res.locals.access));
	})
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/nginx/dns-check/hosts", "post"), req.body);
		res.status(200).send(await internalDnsCheck.check(res.locals.access, payload.hosts));
	});

export default router;
