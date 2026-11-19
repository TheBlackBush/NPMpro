import express from "express";
import requireLogin from "../lib/express/require-login.js";
import PACKAGE from "../package.json" with { type: "json" };
import { getCompiledSchema } from "../schema/index.js";

const router = express.Router({
	caseSensitive: true,
	strict: true,
	mergeParams: true,
});

router
	.route("/")
	.all(requireLogin())

	/**
	 * GET /schema
	 */
	.get(async (req, res) => {
		const schema = await getCompiledSchema();
		const swaggerJSON = {
			...schema,
			info: { ...schema.info, version: PACKAGE.version },
			servers: [{ ...schema.servers[0], url: `${req.protocol}://${req.host}/api` }],
		};
		res.status(200)
			.type("json")
			.send(JSON.stringify(swaggerJSON, null, req.app.get("json spaces")));
	});

export default router;
