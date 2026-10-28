import express from "express";
import { getValidationSchema } from "../../schema/index.js";
import errs from "../error.js";
import apiValidator from "../validator/api.js";

const ID = /^[1-9]\d{0,9}$/u;
const NUMBER_ERRORS = {
	every_hours: "every-hours",
	weekday: "weekday",
	month_day: "month-day",
	keep: "keep",
};

// The validator coerces types, so "3" would pass as 3 and null as 0: these fields must arrive as JSON numbers
const numbersOnly = (body) => {
	if (body === null || typeof body !== "object") return;
	for (const [field, code] of Object.entries(NUMBER_ERRORS)) {
		if (Object.hasOwn(body, field) && typeof body[field] !== "number") {
			throw new errs.ValidationError(`${field} must be a number`, `backup.schedule.error.${code}`);
		}
	}
};

const validated = (path, method, body) => {
	numbersOnly(body);
	return apiValidator(getValidationSchema(path, method), body);
};

const idOf = (req) => {
	if (!ID.test(req.params.id)) throw new errs.ValidationError("Invalid schedule id");
	return Number.parseInt(req.params.id, 10);
};

/**
 * /api/backups/schedules, with the service and the login middleware injected
 */
const createScheduleRouter = ({ service, auth }) => {
	const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

	router
		.route("/")
		.all(auth())

		/**
		 * GET /api/backups/schedules
		 */
		.get(async (_req, res) => {
			res.status(200).send(await service.list(res.locals.access));
		})

		/**
		 * POST /api/backups/schedules
		 */
		.post(async (req, res) => {
			const payload = validated("/backups/schedules", "post", req.body);
			res.status(200).send(await service.create(res.locals.access, payload));
		});

	router
		.route("/:id/run")
		.all(auth())

		/**
		 * POST /api/backups/schedules/:id/run
		 */
		.post(async (req, res) => {
			res.status(200).send(await service.runNow(res.locals.access, idOf(req)));
		});

	router
		.route("/:id")
		.all(auth())

		/**
		 * GET /api/backups/schedules/:id
		 */
		.get(async (req, res) => {
			res.status(200).send(await service.get(res.locals.access, idOf(req)));
		})

		/**
		 * PUT /api/backups/schedules/:id
		 */
		.put(async (req, res) => {
			const id = idOf(req);
			const payload = validated("/backups/schedules/{id}", "put", req.body);
			res.status(200).send(await service.update(res.locals.access, id, payload));
		})

		/**
		 * DELETE /api/backups/schedules/:id?files=true
		 */
		.delete(async (req, res) => {
			await service.remove(res.locals.access, idOf(req), { files: req.query.files === "true" });
			res.status(200).send(true);
		});

	return router;
};

export { createScheduleRouter };
