import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

let api;
let internalNginx;

const HOST = {
	id: 1,
	domain_names: ["forward-auth.example.com"],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 80,
	npmpro_auth_request: "authelia",
	npmpro_auth_request_upstream: "http://auth.internal:9091",
};

before(async () => {
	api = await startApi();
	internalNginx = (await import("../internal/nginx.js")).default;
});
after(() => api?.stop());

it("renders the host's own forward auth upstream without the locations graph too", async () => {
	const withGraph = await internalNginx.renderConfig("proxy_host", { ...HOST, locations: [] });
	const without = await internalNginx.renderConfig("proxy_host", HOST);
	assert.match(withGraph, /auth\.internal/u);
	assert.equal(without, withGraph);
});
