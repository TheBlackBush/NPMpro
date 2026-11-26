import express from "express";
import { rateLimit } from "express-rate-limit";
import internalMailSetting from "../internal/mail-setting.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import sessionOnly from "../lib/express/session-only.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

// a sample alert reaches a real mail server: 5 per minute per IP address, as the test mail
const testLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 5,
	message: { error: { message: "Too many requests, please try again later." } },
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 48,
});

/**
 * /api/settings/notifications
 */
router
	.route("/")
	.all(jwtdecode())

	/** GET /api/settings/notifications */
	.get(async (_, res) => {
		res.status(200).send(await internalMailSetting.getNotifications(res.locals.access));
	})

	/** PUT /api/settings/notifications: the public URL is the address of reset links, so an API token is refused */
	.put(sessionOnly(), async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/notifications", "put"), req.body);
		res.status(200).send(await internalMailSetting.updateNotifications(res.locals.access, payload));
	});

/**
 * /api/settings/notifications/test-alert
 */
router
	.route("/test-alert")
	.all(jwtdecode())

	/** POST /api/settings/notifications/test-alert: like the test mail it carries no link, so an API token may send it */
	.post(testLimiter, async (_, res) => {
		res.status(200).send(await internalMailSetting.testAlerts(res.locals.access));
	});

export default router;
