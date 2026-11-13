import express from "express";
import internalCrowdsecSetting from "../internal/crowdsec-setting.js";
import errs from "../lib/error.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

const PAGES = ["ban", "captcha"];

/**
 * /api/settings/crowdsec
 */
const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

router
	.route("/")
	.all(jwtdecode())

	/** GET /api/settings/crowdsec: never holds the API key or the captcha secret */
	.get(async (_, res) => {
		res.status(200).send(await internalCrowdsecSetting.get(res.locals.access));
	})

	/** PUT /api/settings/crowdsec */
	.put(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/crowdsec", "put"), req.body);
		res.status(200).send(await internalCrowdsecSetting.update(res.locals.access, payload));
	});

router
	.route("/test")
	.all(jwtdecode())

	/** POST /api/settings/crowdsec/test */
	.post(async (req, res) => {
		const payload = apiValidator(getValidationSchema("/settings/crowdsec/test", "post"), req.body ?? {});
		res.status(200).send(await internalCrowdsecSetting.test(res.locals.access, payload));
	});

router
	.route("/preview/:page")
	.all(jwtdecode())

	/** GET /api/settings/crowdsec/preview/{ban|captcha}: nginx serves it with a sandboxed CSP (conf.d/npmpro.conf) */
	.get(async (req, res) => {
		if (!PAGES.includes(req.params.page)) throw new errs.ItemNotFoundError(req.params.page);
		const html = await internalCrowdsecSetting.preview(res.locals.access, req.params.page);
		res.status(200).type("html").send(html);
	});

export default router;
