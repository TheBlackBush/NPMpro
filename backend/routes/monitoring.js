import express from "express";
import { internalMonitoring } from "../internal/monitoring-services.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import validator from "../lib/validator/index.js";

const trafficQuerySchema = {
	type: "object",
	additionalProperties: false,
	required: ["range", "host"],
	properties: {
		range: { type: "string", enum: ["1h", "24h", "7d", "30d"] },
		host: { type: "string", maxLength: 255 },
		host_id: { type: "integer", minimum: 1 },
		host_type: { type: "string", enum: ["proxy", "redirection", "dead"] },
	},
	dependentRequired: { host_id: ["host_type"], host_type: ["host_id"] },
};

const present = (value) => typeof value === "string" && value !== "";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

/**
 * GET /api/monitoring/traffic?range=24h&host=example.com
 * GET /api/monitoring/traffic?range=24h&host_type=proxy&host_id=3
 */
router
	.route("/traffic")
	.all(jwtdecode())
	.get(async (req, res) => {
		const query = validator(trafficQuerySchema, {
			range: typeof req.query.range === "string" && req.query.range !== "" ? req.query.range : "24h",
			host: typeof req.query.host === "string" ? req.query.host.trim().toLowerCase() : "",
			// coerced to an integer by the validator
			...(present(req.query.host_id) ? { host_id: req.query.host_id.trim() } : {}),
			...(present(req.query.host_type) ? { host_type: req.query.host_type } : {}),
		});
		res.status(200).send(await internalMonitoring.getTraffic(res.locals.access, query));
	});

/**
 * GET /api/monitoring/crowdsec
 */
router
	.route("/crowdsec")
	.all(jwtdecode())
	.get(async (_, res) => {
		res.status(200).send(await internalMonitoring.getCrowdsec(res.locals.access));
	});

/**
 * GET /api/monitoring/summary
 */
router
	.route("/summary")
	.all(jwtdecode())
	.get(async (_, res) => {
		res.status(200).send(await internalMonitoring.getSummary(res.locals.access));
	});

export default router;
