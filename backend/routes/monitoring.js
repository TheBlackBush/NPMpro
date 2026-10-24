import express from "express";
import { parseTrafficQuery } from "../internal/monitoring.js";
import { internalMonitoring } from "../internal/monitoring-services.js";
import jwtdecode from "../lib/express/jwt-decode.js";

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
		const query = parseTrafficQuery(req.query);
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
