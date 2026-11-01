import assert from "node:assert/strict";
import { it } from "node:test";
import {
	AUTH_REQUEST_OPTIONS,
	FORWARD_SCHEME_OPTIONS,
	getOptionHintId,
	getOptionsResetByScheme,
	optionField,
	optionId,
	proxyOptionChanges,
	proxyOptionRows,
	X_FRAME_OPTIONS,
} from "./ProxyOptions.js";

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

// the switches as the proxy host window's Details tab had them on develop (ProxyHostModal.jsx, OptionSwitch)
function developRows({ forwardScheme: scheme, npmproProxyRequestBuffering: requestBuffering }) {
	const httpOnly = scheme !== "http" && scheme !== "https";
	const schemeHint = (option) => getOptionHintId(option, scheme);
	return [
		["npmproNoindex", "host.flags.send-noindex", [], false],
		[
			"npmproCrowdsecAppsec",
			"host.flags.disable-crowdsec-appsec",
			requestBuffering ? ["host.flags.hint.appsec-request-buffering"] : [],
			false,
		],
		[
			"npmproProxyRequestBuffering",
			"host.flags.disable-request-buffering",
			["host.flags.hint.request-buffering-appsec", schemeHint("npmproProxyRequestBuffering")],
			httpOnly,
		],
		[
			"npmproProxyResponseBuffering",
			"host.flags.disable-response-buffering",
			[schemeHint("npmproProxyResponseBuffering")],
			httpOnly,
		],
		[
			"npmproUpstreamCompression",
			"host.flags.upstream-compression",
			[schemeHint("npmproUpstreamCompression")],
			["path", "empty"].includes(scheme),
		],
		["npmproFancyindex", "host.flags.fancyindex", [schemeHint("npmproFancyindex")], scheme !== "path"],
	].map(([name, labelId, hintIds, disabled]) => ({ name, labelId, hintIds: hintIds.filter(Boolean), disabled }));
}

it("gives the option switches the labels, hints and disabled state the host window had, for every scheme", () => {
	for (const option of FORWARD_SCHEME_OPTIONS) {
		for (const npmproProxyRequestBuffering of [false, true]) {
			const values = { forwardScheme: option.value, npmproProxyRequestBuffering };
			assert.deepEqual(proxyOptionRows(values), developRows(values), JSON.stringify(values));
		}
	}
});

it("lists the schemes, X-Frame-Options and auth requests the host and the location selects had", () => {
	assert.deepEqual(
		FORWARD_SCHEME_OPTIONS.map((option) => option.value),
		["http", "https", "path", "empty", "grpc", "grpcs"],
	);
	assert.deepEqual(X_FRAME_OPTIONS, ["SAMEORIGIN", "DENY", "none", "upstream"]);
	assert.deepEqual(
		AUTH_REQUEST_OPTIONS.map((option) => option.value),
		["none", "anubis", "tinyauth", "oauth2proxy", "voidauth", "authelia", "authentik", "authentik-send-basic-auth"],
	);
	assert.equal(AUTH_REQUEST_OPTIONS.find((option) => option.value === "authelia").label, "authelia (modern)");
});

it("names the fields and ids of the host and of a location row", () => {
	assert.equal(optionField("", "forwardScheme"), "forwardScheme");
	assert.equal(optionField("locations.2", "forwardScheme"), "locations.2.forwardScheme");
	assert.equal(optionId("forwardScheme"), "forwardScheme");
	assert.equal(optionId("forwardScheme", "abc"), "forwardScheme-abc");
});
