import express from "express";
import internalAcmeAccount from "../internal/acme-account.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import sessionOnly from "../lib/express/session-only.js";
import apiValidator from "../lib/validator/api.js";
import validator from "../lib/validator/index.js";
import { getCompiledSchema, getQuerySchema, getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/settings/acme: the instance CA and its account (administrators only; an Administrator API token may use these
 * routes except replace, which needs a session; secrets are never returned)
 */
router
	.route("/")
	.all(jwtdecode())

	/** GET /api/settings/acme */
	.get(async (_, res) => {
		res.status(200).send(await internalAcmeAccount.getSettings(res.locals.access));
	})

	/** PUT /api/settings/acme */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/acme", "put"), req.body);
		res.status(200).send(await internalAcmeAccount.saveSettings(res.locals.access, payload));
	});

/** POST /api/settings/acme/register: register a pending, failed or missing account now */
router
	.route("/register")
	.all(jwtdecode())
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/acme/register", "post"), req.body ?? {});
		res.status(200).send(await internalAcmeAccount.registerNow(res.locals.access, payload));
	});

/**
 * POST /api/settings/acme/replace: a new account at the CA, its certificates moved to it. Session only: it can
 * deactivate an account at the CA, which cannot be undone
 */
router
	.route("/replace")
	.all(jwtdecode())
	.all(sessionOnly())
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/acme/replace", "post"), req.body);
		res.status(200).send(await internalAcmeAccount.replaceAccount(res.locals.access, payload));
	});

/** GET /api/settings/acme/profiles?server=: the profiles a CA offers */
router
	.route("/profiles")
	.all(jwtdecode())
	.get(async (req, res) => {
		// the documented query parameters (schema/paths/settings/acme/profiles/get.json); other names are ignored
		// the compiled schema is ready once the start finished; awaiting it covers a request that comes earlier
		await getCompiledSchema();
		const schema = getQuerySchema("/settings/acme/profiles", "get");
		const query = validator(
			schema,
			Object.fromEntries(
				Object.keys(schema.properties)
					.filter((name) => name in req.query)
					.map((name) => [name, req.query[name]]),
			),
		);
		res.status(200).send(await internalAcmeAccount.listProfiles(res.locals.access, query));
	});

export default router;
