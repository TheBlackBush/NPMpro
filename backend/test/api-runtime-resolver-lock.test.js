import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// NGINX_RESOLVER set by the user: resolver_addresses is locked, a save that sends it leaves it as the env says
let api;
let admin;

before(async () => {
	api = await startApi({
		env: {
			DISABLE_GRAVATAR: "false",
			DISABLE_NGINX_BEAUTIFIER: "false",
			TZ: "UTC",
			NPMPRO_USER_ENV: "NGINX_RESOLVER",
			NGINX_RESOLVER: "9.9.9.9",
		},
	});
	admin = await api.admin();
});
after(() => api?.stop());

it("locks resolver_addresses when NGINX_RESOLVER is set and leaves it as the env says", async () => {
	const view = (await admin.get("/settings/runtime/nginx")).body;
	assert.deepEqual(view.resolver_addresses, ["9.9.9.9"]);
	assert.ok(view.locked.includes("resolver_addresses"));
	assert.equal(view.locked_by.resolver_addresses, "NGINX_RESOLVER");
	const done = await admin.put("/settings/runtime/nginx", { resolver_addresses: ["8.8.8.8"], resolver_valid: "1m" });
	assert.equal(done.status, 200, done.text);
	assert.deepEqual(done.body.resolver_addresses, ["9.9.9.9"]);
	assert.equal(done.body.resolver_valid, "1m");
	assert.match(
		await api.read("data/npmpro/nginx/resolver.conf"),
		/\nresolver 9\.9\.9\.9 hosts=on ipv6=on valid=1m;\n$/u,
	);
	const row = await api.db("setting").where({ id: "nginx" }).first();
	const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
	assert.equal("resolver_addresses" in meta, false);
});
