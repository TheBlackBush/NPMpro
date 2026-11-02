import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

// scripts/csp-check.js (the CSP gate of the image smoke test) must open every page the app routes to
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const { routes, actions } = JSON.parse(read("../../scripts/csp-check.json"));
const ROUTE = /<Route\s+path="(?<path>[^"]+)"/gu;

it("lists every route of Router.jsx, a route with a parameter as one of its pages", () => {
	const paths = [...read("../Router.jsx").matchAll(ROUTE)].map((match) => match.groups.path);
	assert.ok(paths.length > 10, "the routes of Router.jsx");
	for (const path of paths) {
		const pattern = new RegExp(`^${path.replaceAll("*", ".+").replaceAll(/:\w+/gu, "[^/]+")}$`, "u");
		assert.ok(
			routes.some((route) => pattern.test(route)),
			`${path} is not in scripts/csp-check.json`,
		);
	}
});

it("gives every action a name, a listed route and steps the gate knows", () => {
	for (const action of actions) {
		assert.equal(typeof action.name, "string");
		assert.ok(routes.includes(action.route), `${action.name}: ${action.route} is not a listed route`);
		assert.ok(action.steps.length > 0, action.name);
		for (const step of action.steps) {
			assert.deepEqual(Object.keys(step).length, 1, `${action.name}: one of click, waitFor, press per step`);
			assert.ok(
				["click", "waitFor", "press"].includes(Object.keys(step)[0]),
				`${action.name}: ${Object.keys(step)}`,
			);
		}
	}
});
