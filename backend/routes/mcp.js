import { readFileSync } from "node:fs";
import express from "express";
import { bearerOf } from "../lib/api-token.js";
import jwtdecode from "../lib/express/jwt-decode.js";
import { handleMessage, PROTOCOL_VERSIONS } from "../lib/mcp/server.js";
import { registry, toolCatalogue } from "../lib/mcp/tools.js";

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const router = express.Router({ caseSensitive: true, strict: true, mergeParams: true });

const unauthorised = (res, message) => {
	res.set("WWW-Authenticate", 'Bearer realm="npmpro"');
	return res.status(401).json({ error: { message } });
};

// the MCP endpoint takes an API token only: a browser session cannot drive it
const bearerRequired = (req, res, next) =>
	bearerOf(req.get("authorization")) === null ? unauthorised(res, "An API token is required") : next();
const tokenOnly = (_, res, next) =>
	res.locals.access?.apiToken ? next() : unauthorised(res, "An API token is required");
const knownVersion = (req, res, next) => {
	const version = req.get("mcp-protocol-version");
	if (version === undefined || PROTOCOL_VERSIONS.includes(version)) return next();
	return res.status(400).json({ error: { message: `Unsupported MCP protocol version: ${version}` } });
};
const notAllowed = (_, res) =>
	res
		.set("Allow", "POST")
		.status(405)
		.json({ error: { message: "Method Not Allowed" } });

router
	.route("/")
	.post(bearerRequired, jwtdecode(), tokenOnly, knownVersion, async (req, res) => {
		const answer = await handleMessage(req.body, { access: res.locals.access, registry, version: VERSION });
		if (answer === null) return res.status(202).end();
		res.status(200).json(answer);
	})
	// stateless: no server-sent stream and no session to end
	.get(notAllowed)
	.delete(notAllowed);

/** GET /api/mcp/tools: the tools and what each needs, for Settings, API access (administrators) */
router
	.route("/tools")
	.all(jwtdecode())
	.get((_, res) => {
		res.locals.access.canAdmin();
		res.status(200).send(toolCatalogue());
	});

export default router;
