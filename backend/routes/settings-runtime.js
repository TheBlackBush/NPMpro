import express from "express";
import internalRuntimeSetting from "../internal/runtime-setting.js";
import errs from "../lib/error.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import sessionOnly from "../lib/express/session-only.js";
import { isRuntimeGroup } from "../lib/runtime-rules.js";
import apiValidator from "../lib/validator/api.js";
import { getValidationSchema } from "../schema/index.js";

/**
 * /api/settings/runtime/:group
 */
const runtimeRouter = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

// the groups that decide who can sign in: an API token cannot change them, the Administrator switch included
const SESSION_ONLY_GROUPS = new Set(["forward-auth"]);
const refuseToken = sessionOnly();
const sessionOnlyGroup = (req, res, next) =>
	SESSION_ONLY_GROUPS.has(req.params.group) ? refuseToken(req, res, next) : next();

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
	.put(sessionOnlyGroup, async (req, res) => {
		const group = groupOf(req);
		const payload = apiValidator(getValidationSchema(`/settings/runtime/${group}`, "put"), req.body);
		res.status(200).send(await internalRuntimeSetting.updateRuntime(res.locals.access, group, payload));
	});

export default runtimeRouter;
