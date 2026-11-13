import assert from "node:assert/strict";
import { it } from "node:test";
import { pageWiring } from "../lib/landing-pages/wiring.js";

const LIST = { items: [{ username: "a" }], clients: [], denied_page: "global", denied_list_id: 3 };
const host = (extra = {}) => ({
	id: 7,
	forward_scheme: "http",
	npmpro_page_not_found: "upstream",
	npmpro_page_upstream: "global",
	npmpro_page_maintenance: "global",
	npmpro_maintenance: false,
	npmpro_auth_request: "none",
	access_list: { items: [], clients: [] },
	locations: [],
	...extra,
});

it("defaults: the global upstream error page, intercepted; the upstream's own 404", () => {
	const wiring = pageWiring("proxy_host", host());
	assert.deepEqual(wiring.host, {
		not_found: "",
		upstream_error: "upstream-error",
		denied: "",
		intercept: true,
		maintenance: "",
		certificate: "",
	});
	assert.deepEqual(wiring.locations, [
		{ name: "upstream-error", file: "/data/public/pages/global/upstream-error.html" },
	]);
});

it("an access list that refuses gets the denied page and turns intercepting off", () => {
	const wiring = pageWiring("proxy_host", host({ access_list: LIST }));
	assert.equal(wiring.host.denied, "denied-1");
	assert.equal(wiring.host.intercept, false);
	assert.deepEqual(wiring.locations.at(-1), { name: "denied-1", file: "/data/public/pages/global/denied.html" });
	assert.equal(pageWiring("proxy_host", host({ access_list: { ...LIST, denied_page: "plain" } })).host.denied, "");
	assert.equal(
		pageWiring("proxy_host", host({ access_list: { ...LIST, denied_page: "custom" } })).locations.at(-1).file,
		"/data/public/pages/access-list-3/denied.html",
	);
});

it("forward authentication: no denied page and no intercepting", () => {
	for (const provider of [
		"anubis",
		"tinyauth",
		"oauth2proxy",
		"voidauth",
		"authelia",
		"authentik",
		"authentik-send-basic-auth",
	]) {
		const wiring = pageWiring("proxy_host", host({ access_list: LIST, npmpro_auth_request: provider }));
		assert.equal(wiring.host.denied, "", provider);
		assert.equal(wiring.host.intercept, false, provider);
		assert.equal(wiring.host.upstream_error, "upstream-error", provider);
	}
});

it("grpc and path hosts get the pages without intercepting; upstream choices get nothing", () => {
	assert.equal(pageWiring("proxy_host", host({ forward_scheme: "grpc" })).host.intercept, false);
	assert.equal(
		pageWiring("proxy_host", host({ forward_scheme: "path", npmpro_page_not_found: "npmpro" })).host.not_found,
		"not-found",
	);
	const none = pageWiring("proxy_host", host({ npmpro_page_upstream: "upstream" }));
	assert.deepEqual(none.host, {
		not_found: "",
		upstream_error: "",
		denied: "",
		intercept: false,
		maintenance: "",
		certificate: "",
	});
	assert.deepEqual(none.locations, []);
});

it("locations: the host's pages, their own access list and forward auth; one page location per file", () => {
	const wiring = pageWiring(
		"proxy_host",
		host({
			access_list: LIST,
			locations: [
				{ forward_scheme: "http", access_list: LIST, npmpro_auth_request: "none" },
				{ forward_scheme: "http", npmpro_auth_request: "none" },
				{
					forward_scheme: "https",
					access_list: { ...LIST, denied_list_id: 4, denied_page: "custom" },
					npmpro_auth_request: "none",
				},
				{ forward_scheme: "http", access_list: LIST, npmpro_auth_request: "authelia" },
			],
		}),
	);
	assert.deepEqual(
		wiring.byLocation.map(({ denied, intercept }) => [denied, intercept]),
		[
			["denied-1", false],
			["", true],
			["denied-2", false],
			["", false],
		],
	);
	assert.deepEqual(
		wiring.locations.map(({ name }) => name),
		["upstream-error", "denied-1", "denied-2"],
	);
});

it("a custom choice without html falls back to the global page", () => {
	const wiring = pageWiring("proxy_host", host({ npmpro_page_upstream: "custom", npmpro_page_upstream_html: "" }));
	assert.equal(wiring.locations[0].file, "/data/public/pages/global/upstream-error.html");
	const filled = pageWiring(
		"proxy_host",
		host({ npmpro_page_upstream: "custom", npmpro_page_upstream_html: "<p>x</p>" }),
	);
	assert.equal(filled.locations[0].file, "/data/public/pages/proxy-host-7/upstream-error.html");
});
