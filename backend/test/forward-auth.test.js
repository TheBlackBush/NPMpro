import assert from "node:assert/strict";
import { it } from "node:test";
import {
	locationAuthRequest,
	ownUpstream,
	upstreamConflict,
	upstreamConflicts,
	usesProvider,
} from "../lib/forward-auth.js";

it("a location on global takes the host's provider, none stays none", () => {
	const host = { npmpro_auth_request: "authelia" };
	assert.equal(locationAuthRequest(host, { npmpro_auth_request: "global" }), "authelia");
	assert.equal(locationAuthRequest(host, { npmpro_auth_request: "none" }), "none");
	assert.equal(locationAuthRequest({ npmpro_auth_request: "none" }, { npmpro_auth_request: "global" }), "none");
	assert.equal(locationAuthRequest({}, { npmpro_auth_request: "global" }), "none");
});

it("usesProvider and ownUpstream read a global location as the host's provider without an upstream of its own", () => {
	const host = {
		npmpro_auth_request: "none",
		locations: [{ npmpro_auth_request: "global", npmpro_auth_request_upstream: "http://ignored:1" }],
	};
	assert.equal(usesProvider(host, "authelia"), false);
	assert.equal(ownUpstream(host, "authelia"), "");
	const protectedHost = { ...host, npmpro_auth_request: "authelia", npmpro_auth_request_upstream: "" };
	assert.equal(usesProvider(protectedHost, "authelia"), true);
	assert.equal(ownUpstream(protectedHost, "authelia"), "");
});

it("finds two different upstreams for one provider across the host and its enabled locations", () => {
	const host = {
		npmpro_auth_request: "authelia",
		npmpro_auth_request_upstream: "http://a:9091",
		locations: [
			{ npmpro_auth_request: "authelia", npmpro_auth_request_upstream: "http://b:9091" },
			{ npmpro_auth_request: "global", npmpro_auth_request_upstream: "" },
		],
	};
	const [first] = host.locations;
	assert.deepEqual(upstreamConflict(host), { provider: "authelia", upstreams: ["http://a:9091", "http://b:9091"] });
	assert.equal(upstreamConflict({ ...host, locations: [{ ...first, npmpro_enabled: false }] }), null);
	assert.equal(upstreamConflict({ ...host, locations: [{ ...first, npmpro_auth_request_upstream: "" }] }), null);
	assert.equal(
		upstreamConflict({ ...host, locations: [{ ...first, npmpro_auth_request_upstream: "http://a:9091" }] }),
		null,
	);
	// authentik and authentik-send-basic-auth are one provider
	assert.deepEqual(
		upstreamConflict({
			npmpro_auth_request: "authentik",
			npmpro_auth_request_upstream: "http://a:9000",
			locations: [
				{ npmpro_auth_request: "authentik-send-basic-auth", npmpro_auth_request_upstream: "http://b:9000" },
			],
		}),
		{ provider: "authentik", upstreams: ["http://a:9000", "http://b:9000"] },
	);
});

it("upstreamConflicts lists every conflicting provider", () => {
	const host = {
		npmpro_auth_request: "authelia",
		npmpro_auth_request_upstream: "http://a:1",
		locations: [
			{ npmpro_auth_request: "authelia", npmpro_auth_request_upstream: "http://b:1" },
			{ npmpro_auth_request: "tinyauth", npmpro_auth_request_upstream: "http://c:1" },
			{ npmpro_auth_request: "tinyauth", npmpro_auth_request_upstream: "http://d:1" },
		],
	};
	assert.deepEqual(
		upstreamConflicts(host).map((entry) => entry.provider),
		["tinyauth", "authelia"],
	);
});
