import express from "express";
import jwtdecode from "../lib/express/jwt-decode.js";
import { selectableEvents } from "../lib/notify/catalogue.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/notifications/events
 */
router
	.route("/events")
	.all(jwtdecode())

	/** GET /api/notifications/events: the events the pickers offer, with the channels each one reaches */
	.get((_, res) => {
		res.locals.access.canAdmin();
		res.status(200).send(selectableEvents());
	});

export default router;
