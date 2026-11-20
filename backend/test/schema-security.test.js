import assert from "node:assert/strict";
import { it } from "node:test";
import { getCompiledSchema } from "../schema/index.js";

const SESSION_ONLY = new Set([
	"post /settings/acme/replace",
	"get /tokens",
	"put /users/{userID}/auth",
	"get /users/{userID}/mfa",
	"delete /users/{userID}/mfa",
	"post /users/{userID}/mfa/totp",
	"post /users/{userID}/mfa/totp/enable",
	"post /users/{userID}/mfa/totp/disable",
	"post /users/{userID}/mfa/backup-codes",
	"delete /users/{userID}/sessions",
	"delete /users/{userID}/oidc",
	"post /users/{userID}/avatar",
	"delete /users/{userID}/avatar",
	"get /users/{userID}/api-tokens",
	"post /users/{userID}/api-tokens",
	"delete /users/{userID}/api-tokens/{tokenID}",
	"get /api-tokens",
	"delete /api-tokens/{tokenID}",
	// no token manages users (user decision 2026-11-17)
	"get /users",
	"post /users",
	"put /users/{userID}",
	"delete /users/{userID}",
	"put /users/{userID}/permissions",
	// the settings that decide who can sign in (Administrator switch included)
	"put /settings/oidc",
	"post /settings/oidc/test",
	"post /settings/oidc/icon",
	"delete /settings/oidc/icon",
	"post /settings/oidc/icon/url",
	"put /settings/runtime/forward-auth",
	// the nginx auth_request checks serve browser pages
	"get /auth",
	"get /auth/admin",
]);

const operations = (schema) =>
	Object.entries(schema.paths).flatMap(([path, methods]) =>
		Object.entries(methods).map(([method, op]) => ({ key: `${method} ${path}`, op })),
	);
const schemes = (op) => (op.security ?? []).flatMap((entry) => Object.keys(entry));

it("defines a bearer scheme next to the cookie", async () => {
	const schema = await getCompiledSchema();
	assert.deepEqual(schema.components.securitySchemes.bearerAuth, {
		type: "http",
		scheme: "bearer",
		description: "An API token (npmpro_...), created in the user menu, API tokens",
	});
});

it("every operation with the cookie accepts a bearer, except the session-only ones", async () => {
	const schema = await getCompiledSchema();
	const wrong = operations(schema)
		.filter(({ op }) => schemes(op).includes("cookieAuth"))
		.filter(({ key, op }) => schemes(op).includes("bearerAuth") === SESSION_ONLY.has(key))
		.map(({ key }) => key);
	assert.deepEqual(wrong, []);
	for (const key of SESSION_ONLY) {
		assert.ok(
			operations(schema).some((entry) => entry.key === key),
			`${key} exists`,
		);
	}
});

it("the MCP endpoint takes a bearer only", async () => {
	const schema = await getCompiledSchema();
	assert.deepEqual(schema.paths["/mcp"].post.security, [{ bearerAuth: [] }]);
});
