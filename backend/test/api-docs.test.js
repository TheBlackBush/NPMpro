import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

// /docs sends the browser to the API reference page of the web interface; /schema is the document it reads.

let api;
let admin;

before(async () => {
	api = await startApi();
	admin = await api.admin();
});
after(() => api.stop());

it("redirects /docs and /docs/ to the reference page, signed in or not", async () => {
	for (const client of [admin, api.client()]) {
		for (const path of ["/docs", "/docs/"]) {
			const done = await client.get(path, { redirect: "manual" });
			assert.equal(done.status, 302, path);
			assert.equal(done.headers.get("location"), "/api-reference", path);
		}
	}
});

it("no longer serves the Swagger UI files", async () => {
	for (const path of ["/docs/swagger-ui.css", "/docs/npmpro/docs.css", "/docs/npmpro/fonts/geist-latin.woff2"]) {
		const done = await admin.get(path, { redirect: "manual" });
		assert.equal(done.status, 404, path);
	}
});

it("keeps /schema for signed-in users only", async () => {
	assert.equal((await api.client().get("/schema")).status, 401);
	assert.equal((await admin.get("/schema")).status, 200);
});

it("does not write into the cached schema", async () => {
	const { getCompiledSchema } = await import("../schema/index.js");
	const servers = JSON.stringify((await getCompiledSchema()).servers);
	const done = await admin.get("/schema");
	assert.ok(done.body.servers[0].url.endsWith("/api"));
	assert.equal(JSON.stringify((await getCompiledSchema()).servers), servers);
	assert.equal((await getCompiledSchema()).info.version, "2.x.x");
});
