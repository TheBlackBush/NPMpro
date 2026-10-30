import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import { CERTIFICATE_REQUEST_DEFAULTS } from "./HostForms.js";
import {
	hostRecheckOnScheme,
	insideWebroot,
	locationErrors,
	namedLocations,
	newLocation,
	proxyHostDefaults,
	proxyHostPayload,
	proxyHostValidate,
} from "./ProxyHostForms.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));

const newHost = {
	id: 0,
	domainNames: [],
	forwardHost: "",
	forwardPort: 0,
	accessLists: [],
	locations: [],
	certificateId: 0,
	sslForced: false,
	advancedConfig: "",
	npmproLocationConfig: "",
	npmproDirectory: "",
	npmproMtlsCertificateId: 0,
	npmproMtlsVerifyClientOptional: false,
	npmproMtlsBypassAuthRequest: false,
	npmproHttp3Support: false,
	forwardScheme: "http",
	hstsEnabled: false,
	hstsSubdomains: false,
	npmproNoindex: false,
	npmproCrowdsecAppsec: false,
	npmproProxyResponseBuffering: false,
	npmproProxyRequestBuffering: false,
	npmproUpstreamCompression: false,
	npmproFancyindex: false,
	npmproXFrameOptions: "SAMEORIGIN",
	npmproAuthRequest: "none",
	npmproAuthRequestUpstream: "",
	npmproAccessListType: "public",
};

const savedLocation = {
	id: 11,
	proxyHostId: 5,
	accessLists: [{ id: 2 }],
	path: "/api",
	locationType: "",
	forwardScheme: "path",
	forwardHost: "/srv/files",
	forwardPort: 0,
	advancedConfig: "deny all;",
	npmproAccessListType: "custom",
};

const savedHost = {
	...newHost,
	id: 5,
	domainNames: ["example.com"],
	forwardScheme: "path",
	forwardHost: "/var/www/site",
	forwardPort: 8080,
	accessLists: [{ id: 2 }, { id: 4 }],
	npmproAccessListType: "custom",
	advancedConfig: "add_header X-A 1;",
	npmproLocationConfig: "gzip on;",
	locations: [savedLocation],
};

it("starts a new proxy host with complete values in the window's order", () => {
	const values = proxyHostDefaults(newHost);
	assert.equal(
		Object.values(values).some((value) => value === undefined),
		false,
	);
	assert.deepEqual(Object.keys(values), [
		"domainNames",
		"forwardScheme",
		"forwardHost",
		"forwardPort",
		"npmproNoindex",
		"npmproCrowdsecAppsec",
		"npmproProxyRequestBuffering",
		"npmproProxyResponseBuffering",
		"npmproUpstreamCompression",
		"npmproFancyindex",
		"npmproXFrameOptions",
		"npmproAuthRequest",
		"npmproAuthRequestUpstream",
		"npmproAccessListType",
		"npmproAccessListIds",
		"npmproLocationConfig",
		"locations",
		"certificateId",
		"npmproMtlsCertificateId",
		"npmproMtlsVerifyClientOptional",
		"npmproMtlsBypassAuthRequest",
		"sslForced",
		"npmproHttp3Support",
		"hstsEnabled",
		"hstsSubdomains",
		...Object.keys(CERTIFICATE_REQUEST_DEFAULTS),
		"advancedConfig",
		"npmproDirectory",
	]);
	assert.equal(values.forwardPort, "");
});

it("starts a saved proxy host with its access lists, its locations completed, ports as text", () => {
	const values = proxyHostDefaults(savedHost);
	assert.equal(values.forwardPort, "8080");
	assert.deepEqual(values.npmproAccessListIds, [2, 4]);
	assert.deepEqual(values.locations, [
		newLocation({
			path: "/api",
			locationType: "",
			forwardScheme: "path",
			forwardHost: "/srv/files",
			forwardPort: "",
			advancedConfig: "deny all;",
			npmproAccessListType: "custom",
			npmproAccessListIds: [2],
		}),
	]);
	assert.equal("id" in values.locations[0], false);
});

it("starts a non-admin clone without raw nginx config and without a path target outside /var/www", () => {
	const clone = proxyHostDefaults(savedHost, { isClone: true, isAdmin: false });
	assert.equal(clone.advancedConfig, "");
	assert.equal(clone.npmproLocationConfig, "");
	assert.equal(clone.forwardHost, "/var/www/site");
	assert.equal(clone.locations[0].forwardHost, "");
	assert.equal(clone.locations[0].advancedConfig, "");
	const adminClone = proxyHostDefaults(savedHost, { isClone: true, isAdmin: true });
	assert.equal(adminClone.locations[0].forwardHost, "/srv/files");
	assert.equal(adminClone.advancedConfig, "add_header X-A 1;");
	assert.equal(insideWebroot("/var/www/a/../b"), false);
	assert.equal(insideWebroot("/var/www"), true);
});

it("proxy host: the same errors as the Formik window, its fields and its validate", () => {
	const validate = proxyHostValidate(rules);
	const fresh = proxyHostDefaults(newHost);
	assert.deepEqual(validate(fresh), { domainNames: "This is required", forwardHost: "This is required" });
	const filled = { ...fresh, domainNames: ["example.com"], forwardHost: "10.0.0.1" };
	assert.deepEqual(validate(filled), {});
	assert.deepEqual(validate({ ...filled, forwardScheme: "empty", forwardHost: "" }), {});
	assert.deepEqual(validate({ ...filled, forwardHost: "a;b", forwardPort: "70000" }), {
		forwardPort: "Enter a whole number from 1 to 65535",
		forwardHost: "Must not contain spaces or the characters ; { } \" ' \\ #",
	});
	assert.deepEqual(validate({ ...filled, npmproAuthRequestUpstream: "nope" }), {});
	assert.deepEqual(validate({ ...filled, npmproAuthRequest: "authelia", npmproAuthRequestUpstream: "nope" }), {
		npmproAuthRequestUpstream:
			"Must be a valid URL with scheme, host and port or with scheme and cu_ upstream name (no path)",
	});
	assert.deepEqual(validate({ ...filled, npmproAccessListType: "custom", npmproAccessListIds: [] }), {
		npmproAccessListIds: "This is required",
	});
	assert.deepEqual(validate({ ...filled, certificateId: "new", domainNames: ["*.example.com"] }), {
		domainNames: "Invalid domain: *.example.com",
	});
	assert.deepEqual(
		validate({ ...filled, certificateId: "new", npmproDnsChallenge: true, domainNames: ["*.example.com"] }),
		{ npmproDnsProvider: "This is required" },
	);
	// the rows' errors and the host's own, together
	assert.deepEqual(validate({ ...filled, forwardHost: "", locations: [newLocation()] }), {
		forwardHost: "This is required",
		locations: [{ path: "This is required", forwardHost: "This is required" }],
	});
});

it("locations: the same errors as the Formik rows, blank rows included, one entry per row", () => {
	const rows = [
		newLocation({ path: "/a", forwardHost: "10.0.0.1" }),
		newLocation({ path: "/a", forwardHost: "10.0.0.2" }),
		newLocation({ path: "/b c", forwardScheme: "empty" }),
		newLocation({ path: "/d", forwardHost: "h", forwardPort: "0" }),
		newLocation({ path: "/e", forwardHost: "h", forwardPort: "65536" }),
		newLocation({
			path: "/f",
			forwardHost: "h",
			npmproAuthRequest: "authelia",
			npmproAuthRequestUpstream: "x",
			npmproAccessListType: "custom",
		}),
		newLocation({ path: "/a", locationType: "= ", forwardHost: "h" }),
	];
	assert.deepEqual(locationErrors(rules, rows), [
		undefined,
		{ path: "Another location has the same type and path" },
		{ path: "A path of up to 255 characters without spaces" },
		undefined,
		{ forwardPort: "Enter a whole number from 1 to 65535" },
		{
			npmproAuthRequestUpstream:
				"Must be a valid URL with scheme, host and port or with scheme and cu_ upstream name (no path)",
			npmproAccessListIds: "This is required",
		},
		undefined,
	]);
	assert.equal(locationErrors(rules, [newLocation({ path: "/", forwardHost: "h" })]), undefined);
	assert.equal(locationErrors(rules, []), undefined);
});

it("counts only the rows with a path as locations, as the Formik value did", () => {
	assert.deepEqual(namedLocations([{ path: "/a" }, { path: "  " }, { path: "" }]), [{ path: "/a" }]);
});

it("sends the proxy host as before: public without lists, ports as numbers, rows without keys of their own", () => {
	const values = {
		...proxyHostDefaults(savedHost),
		npmproAccessListType: "public",
		forwardPort: "8081",
		locations: [newLocation({ path: "/x", forwardHost: "h", forwardPort: "" })],
	};
	const payload = proxyHostPayload(values);
	assert.deepEqual(payload.npmproAccessListIds, []);
	assert.equal(payload.forwardPort, 8081);
	assert.equal(payload.locations[0].forwardPort, 0);
	assert.equal("id" in payload.locations[0], false);
	assert.equal("npmproReuseKey" in payload, false);
	assert.equal(proxyHostPayload({ ...values, forwardPort: "" }).forwardPort, 0);
	assert.deepEqual(proxyHostPayload({ ...values, npmproAccessListType: "custom" }).npmproAccessListIds, [2, 4]);
});

it("hostRecheckOnScheme: the forward host is checked again after a scheme change, except when coming back from empty", () => {
	// "empty" needs no host, so a shown "This is required" goes
	assert.equal(hostRecheckOnScheme("http", "empty"), true);
	assert.equal(hostRecheckOnScheme("path", "empty"), true);
	// back from "empty" the host stays quiet until it is left or Save is clicked
	assert.equal(hostRecheckOnScheme("empty", "http"), false);
	assert.equal(hostRecheckOnScheme("empty", "path"), false);
	assert.equal(hostRecheckOnScheme("empty", "grpcs"), false);
	// between schemes that need a host its message follows
	assert.equal(hostRecheckOnScheme("http", "https"), true);
	assert.equal(hostRecheckOnScheme("https", "path"), true);
});
