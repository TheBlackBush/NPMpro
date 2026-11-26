import express from "express";
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

export default router;
