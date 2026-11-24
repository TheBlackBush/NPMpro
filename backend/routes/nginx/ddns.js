import express from "express";
import { checkNow, ddnsStatus, providers } from "../../internal/ddns.js";
import { suggestions } from "../../internal/ddns-suggestions.js";
import jwtdecode from "../../lib/express/jwt-decode.js";

const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

/**
 * /api/nginx/ddns/status
 */
router
	.route("/status")
	.all(jwtdecode())
	.get(async (_req, res) => {
		res.status(200).send(await ddnsStatus(res.locals.access));
	});

/**
 * /api/nginx/ddns/check
 */
router
	.route("/check")
	.all(jwtdecode())
	.post(async (_req, res) => {
		res.status(200).send(await checkNow(res.locals.access));
	});

/**
 * /api/nginx/ddns/providers
 */
router
	.route("/providers")
	.all(jwtdecode())
	.get((_req, res) => {
		res.status(200).send(providers(res.locals.access));
	});

/**
 * /api/nginx/ddns/suggestions
 */
router
	.route("/suggestions")
	.all(jwtdecode())
	.get(async (_req, res) => {
		res.status(200).send(await suggestions(res.locals.access));
	});

export default router;
