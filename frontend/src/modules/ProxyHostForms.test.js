import assert from "node:assert/strict";
import { it } from "node:test";
import { createIntl } from "react-intl";
import en from "../../translations/ui/en.json" with { type: "json" };
import { fieldPaths } from "./HookForm.js";
import { CERTIFICATE_REQUEST_DEFAULTS } from "./HostForms.js";
import { tabOfPath } from "./ModalTabs.js";
import {
	acmeRenewalNotice,
	hostRecheckOnScheme,
	insideWebroot,
	locationAuthNotice,
	locationErrors,
	namedLocations,
	newLocation,
	PROXY_HOST_TABS,
	proxyHostDefaults,
	proxyHostPayload,
	proxyHostValidate,
	replacesAcmeChallenge,
} from "./ProxyHostForms.js";
import { createValidations } from "./ValidationRules.js";

const rules = createValidations(createIntl({ locale: "en", messages: en }));
const DESCRIPTION_LIMIT = /255/u;

const newHost = {
	id: 0,
	domainNames: [],
	npmproDescription: "",
	forwardHost: "",
	forwardPort: 0,
	accessLists: [],
	locations: [],
	certificateId: 0,
	sslForced: false,
	advancedConfig: "",
	npmproLocationConfig: "",
	npmproDirectory: "",
	npmproTags: [],
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
		"npmproDescription",
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
		"npmproTags",
		"npmproMaintenance",
		"npmproPageNotFound",
		"npmproPageNotFoundHtml",
		"npmproPageUpstream",
		"npmproPageUpstreamHtml",
		"npmproPageMaintenance",
		"npmproPageMaintenanceHtml",
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

it("starts a clone without domain names, a non-admin clone also without raw nginx config or a path outside /var/www", () => {
	const clone = proxyHostDefaults(savedHost, { isClone: true, isAdmin: false });
	assert.deepEqual(clone.domainNames, []);
	assert.deepEqual(savedHost.domainNames, ["example.com"]);
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

it("refuses a folder location without the trailing slash before the request, unless it is the saved one", () => {
	const folder = newLocation({ path: "/files", forwardScheme: "path", forwardHost: "/var/www/a/" });
	const message = "A custom location that serves a folder (a path ending in /) must itself end in /.";
	assert.deepEqual(locationErrors(rules, [folder]), [{ path: message }]);
	assert.deepEqual(locationErrors(rules, [{ ...folder, locationType: "^~ " }]), [{ path: message }]);
	assert.equal(locationErrors(rules, [{ ...folder, path: "/files/" }]), undefined);
	assert.equal(locationErrors(rules, [{ ...folder, locationType: "= " }]), undefined);
	assert.equal(locationErrors(rules, [{ ...folder, forwardHost: "/var/www/a" }]), undefined);
	assert.equal(locationErrors(rules, [folder], [folder]), undefined);
	assert.deepEqual(locationErrors(rules, [folder], [{ ...folder, forwardHost: "/var/www/b/" }]), [{ path: message }]);
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

it("puts every field of the proxy host window on exactly one tab, the location rows on Custom Locations", () => {
	const misplaced = fieldPaths(proxyHostDefaults(savedHost)).filter(
		(path) => PROXY_HOST_TABS.filter((tab) => tabOfPath([tab], path) !== null).length !== 1,
	);
	assert.deepEqual(misplaced, []);
	assert.deepEqual(
		PROXY_HOST_TABS.map((tab) => [tab.id, tab.labelId, Boolean(tab.end)]),
		[
			["details", "column.details", false],
			["locations", "column.custom-locations", false],
			["tls", "column.ssl", false],
			["pages", "landing-pages.tab", false],
			["advanced", "domains.advanced", false],
		],
	);
	assert.equal(tabOfPath(PROXY_HOST_TABS, "locations[1].forwardHost"), "locations");
	assert.equal(tabOfPath(PROXY_HOST_TABS, "npmproAccessListIds"), "details");
	assert.equal(tabOfPath(PROXY_HOST_TABS, "npmproDnsRecords[0].reachConfirmed"), "details");
	assert.equal(tabOfPath(PROXY_HOST_TABS, "npmproMtlsBypassAuthRequest"), "tls");
	assert.equal(tabOfPath(PROXY_HOST_TABS, "npmproDirectory"), "details");
	assert.deepEqual(PROXY_HOST_TABS.at(-1).fields, ["advancedConfig", "npmproLocationConfig"]);
	assert.equal(tabOfPath(PROXY_HOST_TABS, "npmproLocationConfig"), "advanced");
});

it("the Pages tab sits between TLS and Advanced and holds the page fields", () => {
	assert.deepEqual(
		PROXY_HOST_TABS.map(({ id }) => id),
		["details", "locations", "tls", "pages", "advanced"],
	);
	assert.deepEqual(PROXY_HOST_TABS.find(({ id }) => id === "pages").fields, [
		"npmproMaintenance",
		"npmproPageNotFound",
		"npmproPageNotFoundHtml",
		"npmproPageUpstream",
		"npmproPageUpstreamHtml",
		"npmproPageMaintenance",
		"npmproPageMaintenanceHtml",
	]);
});

it("a proxy host's page defaults, errors and payload", () => {
	const values = proxyHostDefaults(newHost);
	assert.equal(values.npmproMaintenance, false);
	assert.equal(values.npmproPageNotFound, "upstream");
	assert.equal(values.npmproPageUpstream, "global");
	assert.equal(values.npmproPageMaintenance, "global");
	const filled = { ...values, domainNames: ["a.example.com"], forwardHost: "10.0.0.1", forwardPort: "80" };
	const errors = proxyHostValidate(rules)({ ...filled, npmproPageUpstream: "custom", npmproPageUpstreamHtml: "" });
	assert.ok(errors.npmproPageUpstreamHtml);
	assert.equal(proxyHostValidate(rules)(filled).npmproPageUpstreamHtml, undefined);
	const payload = proxyHostPayload({
		...values,
		npmproPageMaintenance: "custom",
		npmproPageMaintenanceHtml: "<p>x</p>",
	});
	assert.equal(payload.npmproPageMaintenance, "custom");
	assert.equal(payload.npmproPageMaintenanceHtml, "<p>x</p>");
	// another choice sends no html, so the backend keeps a saved custom page
	assert.equal("npmproPageUpstreamHtml" in payload, false);
	assert.equal(payload.npmproPageUpstream, "global");
});

it("a saved custom page comes from the single row and is valid; the list row without html would not be", () => {
	const single = { ...newHost, npmproPageNotFound: "custom", npmproPageNotFoundHtml: "<p>404</p>" };
	const filled = (data) => ({
		...proxyHostDefaults(data),
		domainNames: ["a.example.com"],
		forwardHost: "10.0.0.1",
		forwardPort: "80",
	});
	const validate = proxyHostValidate(rules);
	assert.equal(proxyHostDefaults(single).npmproPageNotFoundHtml, "<p>404</p>");
	assert.equal(validate(filled(single)).npmproPageNotFoundHtml, undefined);
	// what a list answer holds (the backend strips the html): required, so a window must never start from it
	assert.ok(validate(filled({ ...single, npmproPageNotFoundHtml: undefined })).npmproPageNotFoundHtml);
});

it("a new location follows the host's Auth Request, a notice marks a public one on a protected host", () => {
	assert.equal(newLocation().npmproAuthRequest, "global");
	assert.equal(locationAuthNotice("authelia", newLocation({ npmproAuthRequest: "none" })), true);
	assert.equal(locationAuthNotice("authelia", newLocation()), false);
	assert.equal(locationAuthNotice("none", newLocation({ npmproAuthRequest: "none" })), false);
	assert.equal(locationAuthNotice(undefined, newLocation({ npmproAuthRequest: "none" })), false);
	assert.equal(
		locationErrors(rules, [newLocation({ path: "/g", forwardHost: "h", npmproAuthRequestUpstream: "bad" })]),
		undefined,
	);
});

it("replacesAcmeChallenge: only an enabled prefix or ^~ location with exactly /.well-known/acme-challenge/", () => {
	const path = "/.well-known/acme-challenge/";
	assert.equal(replacesAcmeChallenge({ path, locationType: "", npmproEnabled: true }), true);
	assert.equal(replacesAcmeChallenge({ path, locationType: "^~ " }), true);
	assert.equal(replacesAcmeChallenge({ path: `  ${path} `, locationType: "" }), true);
	assert.equal(replacesAcmeChallenge({ path: `"${path}"`, locationType: "" }), true);
	assert.equal(replacesAcmeChallenge({ path: `'${path}'`, locationType: "^~ " }), true);
	assert.equal(replacesAcmeChallenge({ path }), true);
	assert.equal(replacesAcmeChallenge(newLocation({ path })), true);
	for (const locationType of ["= ", "~ ", "~* ", "@"]) {
		assert.equal(replacesAcmeChallenge({ path, locationType }), false);
	}
	assert.equal(replacesAcmeChallenge({ path, locationType: "", npmproEnabled: false }), false);
	assert.equal(replacesAcmeChallenge({ path: "/.well-known/acme-challenge", locationType: "" }), false);
	assert.equal(replacesAcmeChallenge({ path: "/.well-known/acme-challenge/x", locationType: "" }), false);
	assert.equal(replacesAcmeChallenge({ path: "/app/", locationType: "" }), false);
	assert.equal(replacesAcmeChallenge({ path: `"${path}'`, locationType: "" }), false);
	assert.equal(replacesAcmeChallenge({ locationType: "" }), false);
});

it("acmeRenewalNotice: requested without DNS challenge or an existing HTTP challenge Let's Encrypt certificate", () => {
	const row = newLocation({ path: "/.well-known/acme-challenge/" });
	const certificates = [
		{ id: 1, provider: "letsencrypt", npmproDnsChallenge: false },
		{ id: 2, provider: "letsencrypt", npmproDnsChallenge: true },
		{ id: 3, provider: "other" },
	];
	const notice = (certificateId, npmproDnsChallenge = false, list = certificates, location = row) =>
		acmeRenewalNotice(location, { certificateId, npmproDnsChallenge }, list);
	assert.equal(notice("new", false), true);
	assert.equal(notice("new", true), false);
	assert.equal(notice(1), true);
	assert.equal(notice(2), false);
	assert.equal(notice(3), false);
	assert.equal(notice(4), false);
	assert.equal(notice(0), false);
	assert.equal(acmeRenewalNotice(row, { certificateId: 1, npmproDnsChallenge: false }), false);
	assert.equal(notice(1, false, certificates, newLocation({ path: "/app/" })), false);
	assert.equal(notice(1, false, certificates, { ...row, npmproEnabled: false }), false);
});

it("keeps the description on a clone and places it on the Details tab of the proxy host window", () => {
	const described = { ...savedHost, npmproDescription: "Kitchen camera" };
	assert.equal(proxyHostDefaults(described, { isClone: true }).npmproDescription, "Kitchen camera");
	assert.equal(tabOfPath(PROXY_HOST_TABS, "npmproDescription"), "details");
	assert.equal(PROXY_HOST_TABS[0].fields[1], "npmproDescription");
});

it("refuses a proxy host description over 255 characters", () => {
	const errors = proxyHostValidate(rules)({
		...proxyHostDefaults(savedHost),
		npmproDescription: "x".repeat(256),
	});
	assert.match(errors.npmproDescription, DESCRIPTION_LIMIT);
});

it("keeps the tags on a clone, places them on the Details tab and refuses a bad one", () => {
	const tagged = { ...newHost, npmproTags: ["Lab"] };
	assert.deepEqual(proxyHostDefaults(tagged, { isClone: true }).npmproTags, ["Lab"]);
	assert.equal(tabOfPath(PROXY_HOST_TABS, "npmproTags"), "details");
	const errors = proxyHostValidate(rules)({
		...proxyHostDefaults(newHost),
		domainNames: ["a.example.com"],
		forwardHost: "b.example.com",
		forwardPort: "80",
		npmproTags: ["a/b"],
	});
	assert.ok(errors.npmproTags);
});
