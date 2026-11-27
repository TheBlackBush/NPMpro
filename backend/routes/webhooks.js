import express from "express";
import internalWebhook from "../internal/webhook.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import pathId from "../lib/express/path-id.js";
import sessionOnly from "../lib/express/session-only.js";
import { oneAtATime, testMailLimiter } from "../lib/express/test-mail-limiter.js";
import apiValidator from "../lib/validator/api.js";
import validator from "../lib/validator/index.js";
import { getQuerySchema, getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

// the permission is checked before the body, so a user who may not manage webhooks gets 403 whatever they send
const adminOnly = (_req, res, next) => {
	res.locals.access.canAdmin();
	next();
};

router.param("id", pathId);
router.param("delivery_id", pathId);

const pickDefined = (obj) =>
	Object.fromEntries(Object.entries(obj).filter(([, value]) => typeof value === "string" && value !== ""));

/**
 * /api/webhooks (administrators; an API token with the Administrator switch may use it)
 */
router
	.route("/")
	.all(jwtdecode(), adminOnly)

	/** GET /api/webhooks */
	.get(async (_, res) => {
		res.status(200).send(await internalWebhook.list(res.locals.access));
	})

	/** POST /api/webhooks: the signing secret is in this answer only */
	.post(sessionOnly(), async (req, res) => {
		const payload = apiValidator(getValidationSchema("/webhooks", "post"), req.body);
		res.status(201).send(await internalWebhook.create(res.locals.access, payload));
	});

/**
 * /api/webhooks/123
 */
router
	.route("/:id")
	.all(jwtdecode(), adminOnly)

	/** GET /api/webhooks/123 */
	.get(async (req, res) => {
		res.status(200).send(await internalWebhook.get(res.locals.access, Number(req.params.id)));
	})

	/** PUT /api/webhooks/123 */
	.put(sessionOnly(), async (req, res) => {
		const payload = apiValidator(getValidationSchema("/webhooks/{id}", "put"), req.body);
		res.status(200).send(await internalWebhook.update(res.locals.access, Number(req.params.id), payload));
	})

	/** DELETE /api/webhooks/123 */
	.delete(async (req, res) => {
		res.status(200).send(await internalWebhook.remove(res.locals.access, Number(req.params.id)));
	});

/**
 * /api/webhooks/123/rotate-secret
 */
router
	.route("/:id/rotate-secret")
	.all(jwtdecode(), adminOnly)

	/** POST /api/webhooks/123/rotate-secret */
	.post(sessionOnly(), async (req, res) => {
		res.status(200).send(await internalWebhook.rotate(res.locals.access, Number(req.params.id)));
	});

/**
 * /api/webhooks/123/test
 */
router
	.route("/:id/test")
	.all(jwtdecode(), adminOnly)

	/** POST /api/webhooks/123/test */
	.post(
		testMailLimiter,
		oneAtATime(
			async (req, res) => {
				res.status(200).send(await internalWebhook.test(res.locals.access, Number(req.params.id)));
			},
			(req) => `webhook:${Number(req.params.id)}`,
		),
	);

/**
 * /api/webhooks/123/deliveries
 */
router
	.route("/:id/deliveries")
	.all(jwtdecode(), adminOnly)

	/** GET /api/webhooks/123/deliveries */
	.get(async (req, res) => {
		const page = validator(
			getQuerySchema("/webhooks/{id}/deliveries", "get"),
			pickDefined({ limit: req.query.limit, offset: req.query.offset }),
		);
		const { rows, total } = await internalWebhook.deliveries(res.locals.access, Number(req.params.id), {
			limit: page.limit ?? 25,
			offset: page.offset ?? 0,
		});
		res.set("X-Total-Count", String(total));
		res.status(200).send(rows);
	});

/**
 * /api/webhooks/123/deliveries/45/redeliver
 */
router
	.route("/:id/deliveries/:delivery_id/redeliver")
	.all(jwtdecode(), adminOnly)

	/** POST /api/webhooks/123/deliveries/45/redeliver */
	.post(async (req, res) => {
		res.status(200).send(
			await internalWebhook.redeliver(res.locals.access, Number(req.params.id), Number(req.params.delivery_id)),
		);
	});

export default router;
