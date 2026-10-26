import assert from "node:assert/strict";
import { it } from "node:test";
import { assertHostConfig, isInsideWebroot, sameConfig } from "../lib/host-config-guard.js";

const admin = { isAdmin: true };
const user = { isAdmin: false };
const LUA = "location = /x { content_by_lua_block { ngx.say(1) } }";

const CONFIG_REFUSED = { status: 403, message_i18n: "error.advanced-config-admin-only" };
const PATH_REFUSED = { status: 400, message_i18n: "error.path-scheme-webroot" };

it("blank values are the same, anything else must match exactly", () => {
	assert.equal(sameConfig("", undefined), true);
	assert.equal(sameConfig("  \n", null), true);
	assert.equal(sameConfig(undefined, ""), true);
	assert.equal(sameConfig("a", "a"), true);
	assert.equal(sameConfig("a", "a "), false);
	assert.equal(sameConfig("", "a"), false);
	assert.equal(sameConfig("a", ""), false);
});

it("admins may set every free-form field on every host type", () => {
	assert.doesNotThrow(() =>
		assertHostConfig(admin, "proxy_host", {
			advanced_config: LUA,
			npmpro_location_config: LUA,
			locations: [{ path: "/a", advanced_config: LUA, forward_scheme: "path", forward_host: "/" }],
			forward_scheme: "path",
			forward_host: "/data/npmpro/",
		}),
	);
	assert.doesNotThrow(() => assertHostConfig(admin, "redirection_host", { advanced_config: LUA }));
	assert.doesNotThrow(() => assertHostConfig(admin, "dead_host", { advanced_config: LUA }));
	assert.doesNotThrow(() => assertHostConfig(admin, "stream", { npmpro_advanced_config: LUA }));
});

it("non-admins cannot create a host with free-form config, but may send it empty", () => {
	assert.throws(() => assertHostConfig(user, "proxy_host", { advanced_config: LUA }), CONFIG_REFUSED);
	assert.throws(() => assertHostConfig(user, "proxy_host", { npmpro_location_config: "x" }), CONFIG_REFUSED);
	assert.throws(() => assertHostConfig(user, "redirection_host", { advanced_config: LUA }), CONFIG_REFUSED);
	assert.throws(() => assertHostConfig(user, "dead_host", { advanced_config: LUA }), CONFIG_REFUSED);
	assert.throws(() => assertHostConfig(user, "stream", { npmpro_advanced_config: LUA }), CONFIG_REFUSED);
	assert.doesNotThrow(() =>
		assertHostConfig(user, "proxy_host", { advanced_config: "", npmpro_location_config: "" }),
	);
	assert.doesNotThrow(() => assertHostConfig(user, "stream", { npmpro_advanced_config: " " }));
	assert.doesNotThrow(() => assertHostConfig(user, "dead_host", {}));
});

it("non-admins keep stored config when they send it unchanged or omit it, and cannot change or clear it", () => {
	const stored = { advanced_config: LUA, npmpro_location_config: "add_header X 1;" };
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { domain_names: ["a.test"] }, stored));
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { ...stored }, stored));
	assert.throws(() => assertHostConfig(user, "proxy_host", { advanced_config: `${LUA}\n` }, stored), CONFIG_REFUSED);
	assert.throws(() => assertHostConfig(user, "proxy_host", { npmpro_location_config: "" }, stored), CONFIG_REFUSED);
	assert.throws(() => assertHostConfig(user, "proxy_host", { advanced_config: "" }, stored), CONFIG_REFUSED);
	const storedStream = { npmpro_advanced_config: "proxy_timeout 1s;" };
	assert.doesNotThrow(() =>
		assertHostConfig(user, "stream", { npmpro_advanced_config: "proxy_timeout 1s;" }, storedStream),
	);
	assert.throws(
		() => assertHostConfig(user, "stream", { npmpro_advanced_config: LUA }, storedStream),
		CONFIG_REFUSED,
	);
	assert.throws(
		() => assertHostConfig(user, "redirection_host", { advanced_config: LUA }, { advanced_config: "" }),
		CONFIG_REFUSED,
	);
});

it("non-admin locations: new config refused, a matching stored location keeps its config", () => {
	assert.throws(
		() => assertHostConfig(user, "proxy_host", { locations: [{ path: "/a", advanced_config: LUA }] }),
		CONFIG_REFUSED,
	);
	const stored = { locations: [{ location_type: "", path: "/a", advanced_config: LUA }] };
	// unchanged
	assert.doesNotThrow(() =>
		assertHostConfig(
			user,
			"proxy_host",
			{ locations: [{ location_type: "", path: "/a", advanced_config: LUA }] },
			stored,
		),
	);
	// omitted: filled from the stored location
	const data = { locations: [{ location_type: "", path: "/a" }, { path: "/b" }] };
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", data, stored));
	assert.equal(data.locations[0].advanced_config, LUA);
	assert.equal(data.locations[1].advanced_config, "");
	// changed, or moved to another path
	assert.throws(
		() =>
			assertHostConfig(
				user,
				"proxy_host",
				{ locations: [{ path: "/a", advanced_config: "return 200;" }] },
				stored,
			),
		CONFIG_REFUSED,
	);
	assert.throws(
		() => assertHostConfig(user, "proxy_host", { locations: [{ path: "/b", advanced_config: LUA }] }, stored),
		CONFIG_REFUSED,
	);
	assert.throws(
		() =>
			assertHostConfig(
				user,
				"proxy_host",
				{ locations: [{ location_type: "~ ", path: "/a", advanced_config: LUA }] },
				stored,
			),
		CONFIG_REFUSED,
	);
});

it("webroot check normalises and refuses escapes and nginx syntax", () => {
	for (const ok of [
		"/var/www",
		"/var/www/",
		"/var/www/site",
		"/var/www/site/",
		"//var/www/x",
		"/var/www/./x",
		"/var/www//x",
	]) {
		assert.equal(isInsideWebroot(ok), true, ok);
	}
	for (const bad of [
		"/",
		"/data/npmpro/",
		"/var/www/../../data/npmpro/",
		"/var/www/..",
		"/var/www/x/../../etc",
		"/var/wwwx",
		"/var/www-data",
		"/var",
		"var/www/x",
		"",
		undefined,
		"/var/www/$arg_p",
		"/var/www/x;",
		"/var/www/x{",
		'/var/www/"x',
		"/var/www/x\\",
		"/var/www/#x",
		"/var/www/x\u0000",
	]) {
		assert.equal(isInsideWebroot(bad), false, String(bad));
	}
});

it("non-admin path scheme: only inside /var/www, unless the stored path is kept", () => {
	assert.throws(
		() => assertHostConfig(user, "proxy_host", { forward_scheme: "path", forward_host: "/data/npmpro/" }),
		PATH_REFUSED,
	);
	assert.throws(
		() => assertHostConfig(user, "proxy_host", { forward_scheme: "path", forward_host: "/" }),
		PATH_REFUSED,
	);
	assert.throws(
		() =>
			assertHostConfig(user, "proxy_host", {
				forward_scheme: "path",
				forward_host: "/var/www/../../data/npmpro/",
			}),
		PATH_REFUSED,
	);
	assert.doesNotThrow(() =>
		assertHostConfig(user, "proxy_host", { forward_scheme: "path", forward_host: "/var/www/site/" }),
	);
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { forward_scheme: "http", forward_host: "/data" }));

	const stored = { forward_scheme: "path", forward_host: "/srv/admin/", locations: [] };
	// unchanged admin path, also when the fields are omitted
	assert.doesNotThrow(() =>
		assertHostConfig(user, "proxy_host", { forward_scheme: "path", forward_host: "/srv/admin/" }, stored),
	);
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { domain_names: ["a.test"] }, stored));
	// changing the path or switching scheme to path with the stored host
	assert.throws(() => assertHostConfig(user, "proxy_host", { forward_host: "/srv/other/" }, stored), PATH_REFUSED);
	assert.throws(
		() =>
			assertHostConfig(
				user,
				"proxy_host",
				{ forward_scheme: "path" },
				{ forward_scheme: "http", forward_host: "/" },
			),
		PATH_REFUSED,
	);
});

it("non-admin path scheme on custom locations", () => {
	assert.throws(
		() =>
			assertHostConfig(user, "proxy_host", {
				locations: [{ path: "/f", forward_scheme: "path", forward_host: "/" }],
			}),
		PATH_REFUSED,
	);
	assert.doesNotThrow(() =>
		assertHostConfig(user, "proxy_host", {
			locations: [{ path: "/f/", forward_scheme: "path", forward_host: "/var/www/files/" }],
		}),
	);
	const stored = { locations: [{ location_type: "", path: "/f", forward_scheme: "path", forward_host: "/srv/" }] };
	assert.doesNotThrow(() =>
		assertHostConfig(
			user,
			"proxy_host",
			{ locations: [{ location_type: "", path: "/f", forward_scheme: "path", forward_host: "/srv/" }] },
			stored,
		),
	);
	assert.throws(
		() =>
			assertHostConfig(
				user,
				"proxy_host",
				{ locations: [{ location_type: "", path: "/g", forward_scheme: "path", forward_host: "/srv/" }] },
				stored,
			),
		PATH_REFUSED,
	);
});

it("an access without the isAdmin flag is treated as a non-admin", () => {
	assert.throws(() => assertHostConfig({}, "dead_host", { advanced_config: LUA }), CONFIG_REFUSED);
});

const ALIAS_REFUSED = { status: 400, message_i18n: "error.path-scheme-alias-prefix" };
const folderLocation = (path, location_type = "") => ({
	location_type,
	path,
	forward_scheme: "path",
	forward_host: "/var/www/a/",
});

it("non-admin prefix locations that serve a folder must end in a slash", () => {
	for (const type of ["", "^~ "]) {
		assert.throws(
			() => assertHostConfig(user, "proxy_host", { locations: [folderLocation("/x", type)] }),
			ALIAS_REFUSED,
		);
		assert.throws(
			() =>
				assertHostConfig(user, "proxy_host", {
					locations: [{ ...folderLocation("/x", type), forward_host: "/var/www/" }],
				}),
			ALIAS_REFUSED,
		);
		assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { locations: [folderLocation("/x/", type)] }));
	}
	// regex and exact locations map the whole request to the alias, a file path (root) has no alias at all
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { locations: [folderLocation("/x", "= ")] }));
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { locations: [folderLocation("^/x", "~ ")] }));
	assert.doesNotThrow(() =>
		assertHostConfig(user, "proxy_host", {
			locations: [{ ...folderLocation("/x"), forward_host: "/var/www/a" }],
		}),
	);
	assert.doesNotThrow(() => assertHostConfig(admin, "proxy_host", { locations: [folderLocation("/x")] }));
});

it("non-admins may keep a stored folder location without the slash", () => {
	const stored = { locations: [folderLocation("/x")] };
	assert.doesNotThrow(() => assertHostConfig(user, "proxy_host", { locations: [folderLocation("/x")] }, stored));
	assert.throws(
		() =>
			assertHostConfig(
				user,
				"proxy_host",
				{ locations: [{ ...folderLocation("/x"), forward_host: "/var/www/b/" }] },
				stored,
			),
		ALIAS_REFUSED,
	);
});

it("refuses two custom locations with the same type and path, also for admins", () => {
	const twice = { locations: [{ path: "/api" }, { path: "/api" }] };
	assert.throws(() => assertHostConfig(admin, "proxy_host", twice), { status: 400 });
	assert.throws(() => assertHostConfig(user, "proxy_host", twice), { status: 400 });
	const differentType = { locations: [{ path: "/api" }, { location_type: "= ", path: "/api" }] };
	assert.doesNotThrow(() => assertHostConfig(admin, "proxy_host", differentType));
});

it("refuses non-ASCII characters in a non-admin path target", () => {
	for (const value of ["/var/www/sité/", "/var/www/a​b/", "/var/www/‮evil/"]) {
		assert.equal(isInsideWebroot(value), false, value);
	}
	assert.equal(isInsideWebroot("/var/www/site-2_x.y/"), true);
});

it("checks a location without a scheme as http, the scheme it is saved with", () => {
	const stored = { locations: [{ location_type: "", path: "/f/", forward_scheme: "path", forward_host: "/srv/" }] };
	// the payload drops the scheme: saved as http, so no path check applies
	assert.doesNotThrow(() =>
		assertHostConfig(user, "proxy_host", { locations: [{ path: "/f/", forward_host: "app" }] }, stored),
	);
});
