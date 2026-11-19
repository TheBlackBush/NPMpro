import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { getCompiledSchema } from "../schema/index.js";

// The schema tests check every operation that is in the schema. This one checks the other direction as well:
// a route added in Express without a schema entry works but is missing from the API reference.

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

// Routes that are deliberately not in the schema. Each must exist: the test fails when one is gone.
const NOT_IN_SCHEMA = {
	"GET /api/mcp":
		"answers 405 only: the MCP endpoint is stateless, it has no server-sent stream (POST is documented)",
	"DELETE /api/mcp": "answers 405 only: the MCP endpoint is stateless, it has no session to end (POST is documented)",
	"ALL /api/{path}": "the catch-all that answers 404 for every other address under /api",
};

// Routes whose parameter also covers literal paths of the schema, the one place where the shapes need not be equal.
// Every other route must have a schema path of its own shape, so a new `/:id` route is never taken as documented by a
// literal path such as /users/me. Each entry must exist and must still cover a literal path: the test fails otherwise.
const COVERS_LITERALS = {
	"GET /api/settings/runtime/{group}":
		"one route for every runtime settings group; the schema documents each group as its own path with its own answer",
	"PUT /api/settings/runtime/{group}":
		"one route for every runtime settings group; the schema documents each group as its own path with its own body",
	"GET /api/settings/landing-pages/preview/{source}/{type}":
		"one route for the global pages and the default site; the schema documents each source as its own path",
};

const TRAILING_SLASHES = /\/+$/u;
const PARAM = /:(?<name>[A-Za-z_]\w*)/gu;
const ANY_PARAM = /:[A-Za-z_]\w*|\{[^}]+\}/gu;
const MOUNT = /router\.use\(\s*"(?<prefix>\/[^"]*)"/gu;

// Compare path templates by shape: {userID} and {id} are the same route, only the parameter name differs.
const shape = (route) => route.replace(TRAILING_SLASHES, "").replace(ANY_PARAM, "{}").split("/");
const sameShape = (route, operation) =>
	route.method === operation.method &&
	route.shape.length === operation.shape.length &&
	route.shape.every((part, index) => part === operation.shape[index]);
// a parameter of the route also takes a literal segment of the schema (only for the routes in COVERS_LITERALS)
const coversShape = (route, operation) =>
	route.method === operation.method &&
	route.shape.length === operation.shape.length &&
	route.shape.every((part, index) => part === operation.shape[index] || part === "{}");
const asOpenApi = (route) => route.replace(PARAM, "{$<name>}");
const joinPath = (prefix, route) => (route === "/" ? prefix : `${prefix}${route}`);

// An Express 5 mount layer keeps its matcher but not its prefix. The candidates are every `router.use("/x", ...)`
// string of routes/*.js, and a layer takes the one its own matcher accepts as its whole prefix.
const mountCandidates = async () => {
	const dir = path.join(import.meta.dirname, "../routes");
	const files = (await readdir(dir, { recursive: true })).filter((file) => file.endsWith(".js"));
	const found = [];
	for (const file of files) {
		const source = await readFile(path.join(dir, file), "utf8");
		found.push(...[...source.matchAll(MOUNT)].map((match) => match.groups.prefix));
	}
	// two routers mounted at the same prefix in different files are one candidate, not two
	return [...new Set(found)];
};

const prefixOf = (layer, candidates) => {
	const exact = candidates.filter((candidate) => layer.matchers[0](candidate)?.path === candidate);
	return exact.length === 1 ? exact[0] : null;
};

const routesOf = (stack, prefix, { candidates, found, unreadable }) => {
	for (const layer of stack) {
		if (layer.route) {
			const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
			for (const routePath of paths) {
				// the catch-all `router.all(/(?<path>.+)/u)` has a pattern, not a string
				const route = typeof routePath === "string" ? asOpenApi(joinPath(prefix, routePath)) : "/api/{path}";
				// `.all(guard)` next to `.get(...)` sets _all too: only a route with no method of its own answers all of them
				const own = Object.keys(layer.route.methods ?? {}).filter((method) => method !== "_all");
				for (const method of own.length > 0 && typeof routePath === "string" ? own : ["all"]) {
					found.push({ method: method.toUpperCase(), path: route });
				}
			}
		} else if (layer.handle?.stack) {
			const mount = prefixOf(layer, candidates);
			if (mount === null) unreadable.push(prefix);
			else routesOf(layer.handle.stack, joinPath(prefix, mount), { candidates, found, unreadable });
		}
	}
};

const collectRoutes = async () => {
	const { default: main } = await import("../routes/main.js");
	const found = [];
	const unreadable = [];
	routesOf(main.stack, "", { candidates: await mountCandidates(), found, unreadable });
	return { found, unreadable };
};

let root;
before(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "npr-"));
	await mkdir(path.join(root, "data/npmpro"), { recursive: true });
	process.env.NPMPRO_TEST_ROOT = root;
});
after(async () => {
	await rm(root, { recursive: true, force: true });
});

it("has a schema operation for every route and a route for every schema operation", async () => {
	const schema = await getCompiledSchema();
	const base = new URL(schema.servers[0].url).pathname.replace(TRAILING_SLASHES, "");
	const operations = Object.entries(schema.paths).flatMap(([route, item]) =>
		METHODS.filter((method) => item[method]).map((method) => ({
			method: method.toUpperCase(),
			path: `${base}${route}`,
		})),
	);
	const { found: routes, unreadable } = await collectRoutes();
	assert.deepEqual(unreadable, [], "every mounted router has a prefix that can be read from its router.use call");
	const label = ({ method, path: route }) => `${method} ${route}`;

	const allowed = new Set(Object.keys(NOT_IN_SCHEMA));
	for (const entry of allowed) {
		assert.ok(
			routes.some((route) => label(route) === entry),
			`the allowlisted route ${entry} no longer exists, remove it`,
		);
	}

	const withShape = (item) => ({ ...item, shape: shape(item.path) });
	const served = routes.map(withShape);
	const documented = operations.map(withShape);
	const covering = new Set(Object.keys(COVERS_LITERALS));
	const matches = (route, op) => sameShape(route, op) || (covering.has(label(route)) && coversShape(route, op));
	for (const entry of covering) {
		const route = served.find((item) => label(item) === entry);
		assert.ok(route, `the route ${entry} in COVERS_LITERALS no longer exists, remove it`);
		assert.ok(
			documented.some((op) => !sameShape(route, op) && coversShape(route, op)),
			`the route ${entry} in COVERS_LITERALS covers no literal schema path any more, remove it`,
		);
	}
	const missingInSchema = served.filter(
		(route) => !allowed.has(label(route)) && !documented.some((op) => matches(route, op)),
	);
	const missingRoute = documented.filter((op) => !served.some((route) => matches(route, op)));

	const hint = "add backend/schema/paths/... and its reference in swagger.json";
	assert.deepEqual(
		missingInSchema.map(label),
		[],
		`routes without a schema operation (${hint}): ${missingInSchema.map(label).join(", ")}`,
	);
	assert.deepEqual(
		missingRoute.map(label),
		[],
		`schema operations without a route (remove them or add the route): ${missingRoute.map(label).join(", ")}`,
	);
});
