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

// a test mail reaches a real mail server: 5 per minute per address
const testLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 5,
	message: { error: { message: "Too many requests, please try again later." } },
	standardHeaders: "draft-8",
	legacyHeaders: false,
	ipv6Subnet: 48,
});

/**
 * /api/settings/email
 */
router
	.route("/")
	.all(jwtdecode())

	/** GET /api/settings/email: the mail settings (the password is never returned) */
	.get(async (_, res) => {
		res.status(200).send(await internalMailSetting.getEmail(res.locals.access));
	})

	/** PUT /api/settings/email: the server and the login the app mails go through, so an API token is refused */
	.put(sessionOnly(), async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/email", "put"), req.body);
		res.status(200).send(await internalMailSetting.updateEmail(res.locals.access, payload));
	});

/**
 * /api/settings/email/test
 */
router
	.route("/test")
	.all(jwtdecode())

	/** POST /api/settings/email/test */
	.post(testLimiter, async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/email/test", "post"), req.body ?? {});
		res.status(200).send(await internalMailSetting.testEmail(res.locals.access, payload));
	});

export default router;
