import assert from "node:assert/strict";
import { it } from "node:test";
import { adminRedirect } from "./AdminRoutes.js";

it("sends the old Users and Audit Log addresses to their Settings sections", () => {
	assert.equal(adminRedirect("/users", ""), "/settings/users");
	assert.equal(adminRedirect("/audit-log", ""), "/settings/audit-log");
});

it("keeps the query string", () => {
	assert.equal(
		adminRedirect("/audit-log", "?objectType=proxy-host&page=2"),
		"/settings/audit-log?objectType=proxy-host&page=2",
	);
});

it("leaves every other address alone", () => {
	for (const path of ["/", "/settings/users", "/users/1", "/audit-logs", "/nginx/proxy"]) {
		assert.equal(adminRedirect(path, ""), null, path);
	}
});
