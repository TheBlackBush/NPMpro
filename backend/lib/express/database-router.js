import express from "express";
import { getValidationSchema } from "../../schema/index.js";
import errs from "../error.js";
import apiValidator from "../validator/api.js";

// the validator coerces types ("5432" to 5432, 1 to true); a target is taken as sent, so a value whose type changed
// is refused
const refuseCoerced = (before, after, label = "") => {
	for (const [key, value] of Object.entries(after ?? {})) {
		const sent = before?.[key];
		if (value !== null && typeof value === "object") {
			refuseCoerced(sent, value, `${label}${key}.`);
		} else if (typeof sent !== typeof value) {
			throw new errs.ValidationError(`${label}${key} has the wrong type`);
		}
	}
};

// the password is taken as typed (the validator leaves it untrimmed)
const validated = (path, body) => {
	const payload = apiValidator(getValidationSchema(path, "post"), body);
	refuseCoerced(body, payload);
	return payload;
};

// settles once the answer went out or the connection closed: a move restarts the process only after it
const answerSent = (res) =>
	new Promise((resolve) => {
		res.once("finish", resolve);
		res.once("close", resolve);
	});

/**
 * /api/database, with the service and the login middleware injected; the service checks admin access. No catch-all
 * or parameter routes: the maintenance guard lets exactly the move's own paths through.
 */
const createDatabaseRouter = ({ service, auth }) => {
	const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

	/**
	 * GET /api/database
	 */
	router
		.route("/")
		.all(auth())
		.get(async (_req, res) => {
			const result = await service.status(res.locals.access);
			res.status(200).send(result);
		});

	/**
	 * POST /api/database/test
	 */
	router
		.route("/test")
		.all(auth())
		.post(async (req, res) => {
			const result = await service.test(res.locals.access, validated("/database/test", req.body));
			res.status(200).send(result);
		});

	router
		.route("/move")
		.all(auth())

		/**
		 * GET /api/database/move
		 */
		.get(async (_req, res) => {
			const result = await service.progress(res.locals.access);
			res.status(200).send(result);
		})

		/**
		 * POST /api/database/move
		 */
		.post(async (req, res) => {
			const body = validated("/database/move", req.body);
			const sent = answerSent(res);
			const result = await service.move(res.locals.access, body, { sent });
			res.status(200).send(result);
		});

	return router;
};

export { createDatabaseRouter };
