import assert from "node:assert/strict";
import { it } from "node:test";
import { getOptionsResetByScheme, proxyOptionChanges } from "./ProxyOptions.js";

it("switches off what a forward scheme cannot use, as the host and the location rows did", () => {
	assert.deepEqual(proxyOptionChanges("forwardScheme", "http"), {
		forwardScheme: "http",
		npmproFancyindex: false,
	});
	assert.deepEqual(proxyOptionChanges("forwardScheme", "path"), {
		forwardScheme: "path",
		npmproProxyRequestBuffering: false,
		npmproProxyResponseBuffering: false,
		npmproUpstreamCompression: false,
	});
	assert.deepEqual(proxyOptionChanges("forwardScheme", "grpc"), {
		forwardScheme: "grpc",
		npmproProxyRequestBuffering: false,
		npmproProxyResponseBuffering: false,
		npmproFancyindex: false,
	});
	assert.deepEqual(proxyOptionChanges("forwardScheme", "empty"), { forwardScheme: "empty" });
});

it("links AppSec and request buffering, and empties the auth upstream without an auth request", () => {
	assert.deepEqual(proxyOptionChanges("npmproCrowdsecAppsec", false), {
		npmproCrowdsecAppsec: false,
		npmproProxyRequestBuffering: false,
	});
	assert.deepEqual(proxyOptionChanges("npmproCrowdsecAppsec", true), { npmproCrowdsecAppsec: true });
	assert.deepEqual(proxyOptionChanges("npmproProxyRequestBuffering", true), {
		npmproProxyRequestBuffering: true,
		npmproCrowdsecAppsec: true,
	});
	assert.deepEqual(proxyOptionChanges("npmproAuthRequest", "none"), {
		npmproAuthRequest: "none",
		npmproAuthRequestUpstream: "",
	});
	assert.deepEqual(proxyOptionChanges("npmproAuthRequest", "authelia"), { npmproAuthRequest: "authelia" });
	assert.deepEqual(proxyOptionChanges("npmproNoindex", true), { npmproNoindex: true });
});

it("names the enabled options a scheme change switches off (the notice under the scheme)", () => {
	const values = { npmproProxyRequestBuffering: true, npmproFancyindex: false, npmproUpstreamCompression: true };
	assert.deepEqual(getOptionsResetByScheme(values, "path"), [
		"npmproProxyRequestBuffering",
		"npmproUpstreamCompression",
	]);
	assert.deepEqual(getOptionsResetByScheme(values, "empty"), []);
});
