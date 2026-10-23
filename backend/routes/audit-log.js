import express from "express";
import internalAuditLog from "../internal/audit-log.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import validator from "../lib/validator/index.js";

const listSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		expand: {
			$ref: "common#/properties/expand",
			items: { enum: ["user"] },
		},
		query: {
			$ref: "common#/properties/query",
		},
		limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
		offset: { type: "integer", minimum: 0, default: 0 },
		object_type: {
			type: "string",
			enum: [
				"proxy-host",
				"redirection-host",
				"dead-host",
				"stream",
				"access-list",
				"certificate",
				"dns-credential",
				"user",
				"setting",
			],
		},
		action: { type: "string", enum: ["created", "updated", "deleted", "enabled", "disabled"] },
		user_id: { $ref: "common#/properties/id" },
	},
};

const pickDefined = (obj) =>
	Object.fromEntries(Object.entries(obj).filter(([, value]) => typeof value === "string" && value !== ""));

const eventSchema = {
	type: "object",
	required: ["event_id"],
	additionalProperties: false,
	properties: {
		event_id: {
			$ref: "common#/properties/id",
		},
		expand: {
			$ref: "common#/properties/expand",
			items: { enum: ["user"] },
		},
	},
};

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * /api/audit-log
 */
router
	.route("/")
	.all(jwtdecode())

	/**
	 * GET /api/audit-log
	 *
	 * Retrieve all logs
	 */
	.get(async (req, res) => {
		const data = validator(listSchema, {
			expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
			query: typeof req.query.query === "string" ? req.query.query : null,
			...pickDefined({
				limit: req.query.limit,
				offset: req.query.offset,
				object_type: req.query.object_type,
				action: req.query.action,
				user_id: req.query.user_id,
			}),
		});
		const { rows, total } = await internalAuditLog.getAll(res.locals.access, {
			expand: data.expand,
			query: data.query,
			limit: data.limit ?? 50,
			offset: data.offset ?? 0,
			objectType: data.object_type,
			action: data.action,
			userId: data.user_id,
		});
		res.set("X-Total-Count", String(total));
		res.status(200).send(rows);
	});

/**
 * Specific audit log entry
 *
 * /api/audit-log/123
 */
router
	.route("/:event_id")
	.all(jwtdecode())

	/**
	 * GET /api/audit-log/123
	 *
	 * Retrieve a specific entry
	 */
	.get(async (req, res) => {
		const data = validator(eventSchema, {
			event_id: req.params.event_id,
			expand: typeof req.query.expand === "string" ? req.query.expand.split(",") : null,
		});

		const item = await internalAuditLog.get(res.locals.access, {
			id: data.event_id,
			expand: data.expand,
		});
		res.status(200).send(item);
	});

export default router;
