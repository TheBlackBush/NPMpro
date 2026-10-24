import express from "express";
import internalRuntimeSetting from "../internal/runtime-setting.js";
import errs from "../lib/error.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import { isRuntimeGroup } from "../lib/runtime-rules.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

/**
 * /api/settings/runtime/:group
 */
const runtimeRouter = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

const groupOf = (req) => {
	const { group } = req.params;
	if (!isRuntimeGroup(group)) throw new errs.ItemNotFoundError(group);
	return group;
};

runtimeRouter
	.route("/:group")
	.all(jwtdecode())

	/**
	 * GET /api/settings/runtime/:group
	 */
	.get(async (req, res) => {
		res.status(200).send(await internalRuntimeSetting.getRuntime(res.locals.access, groupOf(req)));
	})

	/**
	 * PUT /api/settings/runtime/:group
	 *
	 * Fields set by environment variables are ignored
	 */
	.put(async (req, res) => {
		const group = groupOf(req);
		const payload = apiValidator(getValidationSchema(`/settings/runtime/${group}`, "put"), req.body);
		res.status(200).send(await internalRuntimeSetting.updateRuntime(res.locals.access, group, payload));
	});

export default runtimeRouter;
