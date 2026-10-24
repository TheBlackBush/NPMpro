import express from "express";
import internalMonitoringSetting from "../internal/monitoring-setting.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

const options = { caseSensitive: true, strict: true, mergeParams: true };

/**
 * /api/settings/monitoring
 */
const monitoringRouter = express.Router(options);

monitoringRouter
	.route("/")
	.all(jwtdecode())

	/**
	 * GET /api/settings/monitoring
	 */
	.get(async (_, res) => {
		res.status(200).send(await internalMonitoringSetting.getMonitoring(res.locals.access));
	})

	/**
	 * PUT /api/settings/monitoring
	 */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/monitoring", "put"), req.body);
		res.status(200).send(await internalMonitoringSetting.updateMonitoring(res.locals.access, payload));
	});

/**
 * /api/settings/geoip
 */
const geoipRouter = express.Router(options);

geoipRouter
	.route("/")
	.all(jwtdecode())

	/**
	 * GET /api/settings/geoip
	 *
	 * The license key is never returned
	 */
	.get(async (_, res) => {
		res.status(200).send(await internalMonitoringSetting.getGeoip(res.locals.access));
	})

	/**
	 * PUT /api/settings/geoip
	 */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/geoip", "put"), req.body);
		res.status(200).send(await internalMonitoringSetting.updateGeoip(res.locals.access, payload));
	});

geoipRouter
	.route("/update")
	.all(jwtdecode())

	/**
	 * POST /api/settings/geoip/update
	 *
	 * Download the GeoIP databases now
	 */
	.post(async (_, res) => {
		res.status(200).send(await internalMonitoringSetting.updateGeoipNow(res.locals.access));
	});

export { geoipRouter, monitoringRouter };
