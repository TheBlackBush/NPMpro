import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

let api;
let internalNginx;

before(async () => {
	api = await startApi();
	internalNginx = (await import("../internal/nginx.js")).default;
});
after(() => api?.stop());

const LIST = { id: 3, items: [{ username: "u", password: "p" }], clients: [], npmpro_denied_page: "global" };
const proxyHost = (extra = {}) => ({
	id: 11,
	domain_names: ["pages.example.com"],
	forward_scheme: "http",
	forward_host: "10.0.0.1",
	forward_port: 8080,
	npmpro_page_not_found: "upstream",
	npmpro_page_upstream: "global",
	npmpro_page_maintenance: "global",
	npmpro_maintenance: false,
	npmpro_auth_request: "none",
	npmpro_access_list_type: "public",
	locations: [],
	...extra,
});
const render = (host) => internalNginx.renderConfig("proxy_host", host);
const locationBlock = (config, path) => {
	const start = config.indexOf(`location ${path} {`);
	assert.ok(start >= 0, `no location ${path}`);
	let depth = 0;
	for (let index = config.indexOf("{", start); index < config.length; index += 1) {
		if (config[index] === "{") depth += 1;
		if (config[index] === "}" && --depth === 0) return config.slice(start, index + 1);
	}
	throw new Error("unbalanced");
};

it("defaults: the upstream error page with intercepting, no 404 page, no denied page", async () => {
	const config = await render(proxyHost());
	const root = locationBlock(config, "/");
	assert.match(root, /error_page 502 503 504 \/\.npmpro-page\/upstream-error;/u);
	assert.match(root, /proxy_intercept_errors on;/u);
	assert.doesNotMatch(root, /error_page 404|error_page 401 403/u);
	const page = locationBlock(config, "= /.npmpro-page/upstream-error");
	assert.match(page, /internal;/u);
	assert.match(page, /ssi on;/u);
	assert.match(page, /alias \/data\/public\/pages\/global\/upstream-error\.html;/u);
	// error_page stays out of the server level, so nginx.conf's error_page 497 still applies
	assert.doesNotMatch(config.slice(0, config.indexOf("location")), /error_page/u);
});

it("the upstream's own error: nothing intercepted, no page location", async () => {
	const config = await render(proxyHost({ npmpro_page_upstream: "upstream" }));
	assert.doesNotMatch(config, /error_page|proxy_intercept_errors|npmpro-page/u);
});

it("a 404 page and the built-in or custom files", async () => {
	const config = await render(
		proxyHost({
			npmpro_page_not_found: "npmpro",
			npmpro_page_upstream: "custom",
			npmpro_page_upstream_html: "<p>x</p>",
		}),
	);
	assert.match(locationBlock(config, "/"), /error_page 404 \/\.npmpro-page\/not-found;/u);
	assert.match(config, /alias \/usr\/local\/nginx\/html\/npmpro\/404\.html;/u);
	assert.match(config, /alias \/data\/public\/pages\/proxy-host-11\/upstream-error\.html;/u);
});

it("an access list: the denied page keeps the 401 status (no =code), the upstream's 401 and 403 pass", async () => {
	const config = await render(proxyHost({ npmpro_access_list_type: "custom", access_lists: [LIST] }));
	const root = locationBlock(config, "/");
	assert.match(root, /error_page 401 403 \/\.npmpro-page\/denied-1;/u);
	assert.doesNotMatch(root, /proxy_intercept_errors/u);
	assert.match(root, /auth_basic_user_file/u);
	assert.match(
		locationBlock(config, "= /.npmpro-page/denied-1"),
		/alias \/data\/public\/pages\/global\/denied\.html;/u,
	);
	const plain = await render(
		proxyHost({ npmpro_access_list_type: "custom", access_lists: [{ ...LIST, npmpro_denied_page: "plain" }] }),
	);
	assert.doesNotMatch(locationBlock(plain, "/"), /error_page 401 403/u);
});

it("forward authentication keeps its own error_page and gets no denied page or intercepting", async () => {
	for (const provider of [
		"anubis",
		"tinyauth",
		"oauth2proxy",
		"voidauth",
		"authelia",
		"authentik",
		"authentik-send-basic-auth",
	]) {
		const config = await render(
			proxyHost({
				npmpro_access_list_type: "custom",
				access_lists: [LIST],
				npmpro_auth_request: provider,
				npmpro_auth_request_upstream: "http://127.0.0.1:9000",
			}),
		);
		const root = locationBlock(config, "/");
		assert.doesNotMatch(root, /npmpro-page\/denied|proxy_intercept_errors/u, provider);
		assert.match(root, /error_page 502 503 504 \/\.npmpro-page\/upstream-error;/u, provider);
		assert.match(root, /error_page 401/u, provider);
	}
});

it("custom locations get the host's pages and their own denied page", async () => {
	const config = await render(
		proxyHost({
			locations: [
				{
					id: 1,
					path: "/app",
					location_type: "",
					forward_scheme: "http",
					forward_host: "10.0.0.2",
					forward_port: 80,
					npmpro_access_list_type: "custom",
					access_lists: [LIST],
					npmpro_auth_request: "none",
				},
				{
					id: 2,
					path: "/api",
					location_type: "",
					forward_scheme: "http",
					forward_host: "10.0.0.3",
					forward_port: 80,
					npmpro_access_list_type: "public",
					npmpro_auth_request: "none",
				},
			],
		}),
	);
	const app = locationBlock(config, '"/app"');
	assert.match(app, /error_page 401 403 \/\.npmpro-page\/denied-1;/u);
	assert.doesNotMatch(app, /proxy_intercept_errors/u);
	const apiBlock = locationBlock(config, '"/api"');
	assert.match(apiBlock, /error_page 502 503 504 \/\.npmpro-page\/upstream-error;/u);
	assert.match(apiBlock, /proxy_intercept_errors on;/u);
});

it("a custom choice without html points at the global page, never at a missing file", async () => {
	const config = await render(proxyHost({ npmpro_page_upstream: "custom", npmpro_page_upstream_html: "" }));
	assert.match(config, /alias \/data\/public\/pages\/global\/upstream-error\.html;/u);
	assert.doesNotMatch(config, /proxy-host-11/u);
	const list = { ...LIST, npmpro_denied_page: "custom", npmpro_denied_page_html: "" };
	const denied = await render(proxyHost({ npmpro_access_list_type: "custom", access_lists: [list] }));
	assert.match(denied, /alias \/data\/public\/pages\/global\/denied\.html;/u);
	assert.doesNotMatch(denied, /access-list-3/u);
});

it("every page location is internal, serves html and runs SSI", async () => {
	const config = await render(
		proxyHost({ npmpro_page_not_found: "npmpro", npmpro_access_list_type: "custom", access_lists: [LIST] }),
	);
	for (const name of ["upstream-error", "not-found", "denied-1"]) {
		const page = locationBlock(config, `= /.npmpro-page/${name}`);
		assert.match(page, /default_type text\/html;/u, name);
		assert.match(page, /internal;/u, name);
		assert.match(page, /ssi on;/u, name);
	}
});

it("a host error_page or proxy_intercept_errors of its own is not doubled", async () => {
	const own = await render(proxyHost({ advanced_config: "error_page 502 /x.html;" }));
	assert.doesNotMatch(own, /npmpro-page|proxy_intercept_errors/u);
	const flag = await render(proxyHost({ npmpro_location_config: "proxy_intercept_errors off;" }));
	assert.equal(flag.match(/proxy_intercept_errors/gu).length, 1);
});

it("an error_page in location / config or a custom location's config replaces ours there only", async () => {
	const config = await render(
		proxyHost({
			npmpro_location_config: "error_page 502 /mine.html;",
			locations: [
				{
					id: 1,
					path: "/app",
					location_type: "",
					forward_scheme: "http",
					forward_host: "10.0.0.2",
					forward_port: 80,
					npmpro_access_list_type: "public",
					npmpro_auth_request: "none",
				},
				{
					id: 2,
					path: "/api",
					location_type: "",
					forward_scheme: "http",
					forward_host: "10.0.0.3",
					forward_port: 80,
					npmpro_access_list_type: "public",
					npmpro_auth_request: "none",
					advanced_config: "error_page 502 /api.html;",
				},
			],
		}),
	);
	const root = locationBlock(config, "/");
	assert.equal(root.match(/error_page/gu).length, 1);
	assert.doesNotMatch(root, /proxy_intercept_errors/u);
	assert.match(locationBlock(config, '"/app"'), /error_page 502 503 504 \/\.npmpro-page\/upstream-error;/u);
	assert.equal(locationBlock(config, '"/api"').match(/error_page/gu).length, 1);
	assert.equal(config.match(/location = \/\.npmpro-page\//gu).length, 1);
});
