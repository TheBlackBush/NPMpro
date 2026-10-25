import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import { quoteLocation, quoteNginxString } from "../lib/nginx-quote.js";
import utils from "../lib/utils.js";

const PHP_AUTH_STRIPPED =
	/include fastcgi\.conf;\s+fastcgi_param PATH_INFO \$fastcgi_path_info;\s+fastcgi_param HTTP_AUTHORIZATION "";\s+fastcgi_pass unix:\/run\/php1\.sock;/u;

const render = async (location) => {
	const template = await readFile(
		path.join(import.meta.dirname, "../templates/_proxy_host_custom_location.conf"),
		"utf8",
	);
	return utils.getRenderEngine().parseAndRender(template, { ...location, ...quoteLocation(location) });
};

const firstLine = (text) => text.split("\n").find((line) => line.startsWith("location"));

it("quotes strings so nginx reads back the original value", () => {
	assert.equal(quoteNginxString("\\d{3}"), '"\\\\d{3}"');
	assert.equal(quoteNginxString('a"b'), '"a\\"b"');
	// a trailing backslash cannot escape the closing quote
	assert.equal(quoteNginxString("a\\"), '"a\\\\"');
	assert.equal(quoteNginxString('a\\";x'), '"a\\\\\\";x"');
});

it("custom location paths are quoted for every location type", async () => {
	const base = { forward_scheme: "http", forward_host: "a", forward_upstream_name: "u", access_list: {} };
	assert.equal(
		firstLine(await render({ ...base, location_type: "~ ", path: "^/api/\\d{3}$" })),
		'location ~ "^/api/\\\\d{3}$" {',
	);
	assert.equal(
		firstLine(await render({ ...base, location_type: "~* ", path: "\\.php$" })),
		'location ~* "\\\\.php$" {',
	);
	assert.equal(firstLine(await render({ ...base, location_type: "", path: "/app" })), 'location "/app" {');
	assert.equal(firstLine(await render({ ...base, location_type: "= ", path: "/x" })), 'location = "/x" {');
	assert.equal(firstLine(await render({ ...base, location_type: "^~ ", path: "/s/" })), 'location ^~ "/s/" {');
	assert.equal(firstLine(await render({ ...base, location_type: "@", path: "named" })), 'location "@named" {');
});

it("a breakout attempt stays inside the quoted path", async () => {
	const base = { forward_scheme: "http", forward_host: "a", forward_upstream_name: "u", access_list: {} };
	const out = await render({
		...base,
		location_type: "~ ",
		path: '/a"{proxy_pass~http://127.0.0.1:80;}location=/injected{return~418;',
	});
	assert.equal(firstLine(out), 'location ~ "/a\\"{proxy_pass~http://127.0.0.1:80;}location=/injected{return~418;" {');
	assert.equal(out.split("\n").filter((line) => line.trimStart().startsWith("location")).length, 1);
});

it("basic auth without pass_auth strips the credentials for grpc and PHP custom locations", async () => {
	const access_list = { items: [{ username: "u" }], clients: [], pass_auth: false };
	const grpc = await render({
		location_type: "",
		path: "/g",
		forward_scheme: "grpc",
		forward_host: "a",
		forward_upstream_name: "u",
		access_list,
		filename: "/data/x",
	});
	assert.ok(grpc.includes('proxy_set_header Authorization "";'));
	assert.ok(grpc.includes('grpc_set_header Authorization "";'));

	const php = await render({
		location_type: "",
		path: "/p",
		forward_scheme: "path",
		forward_host: "/var/www/",
		forward_port: 1,
		access_list,
		filename: "/data/x",
	});
	assert.match(php, PHP_AUTH_STRIPPED);

	const passed = await render({
		location_type: "",
		path: "/p",
		forward_scheme: "path",
		forward_host: "/var/www/",
		forward_port: 1,
		access_list: { ...access_list, pass_auth: true },
		filename: "/data/x",
	});
	assert.ok(!passed.includes("HTTP_AUTHORIZATION"));
	assert.ok(!passed.includes("grpc_set_header Authorization"));
});

it("a path the user quoted by hand keeps its meaning", () => {
	assert.equal(quoteLocation({ location_type: "~ ", path: '"^/api/\\d{3}$"' }).path, '"^/api/\\\\d{3}$"');
	assert.equal(quoteLocation({ location_type: "~* ", path: "'^/v\\d{2}/'" }).path, '"^/v\\\\d{2}/"');
	assert.equal(quoteLocation({ location_type: "", path: '"/quoted/"' }).path, '"/quoted/"');
	assert.equal(quoteLocation({ location_type: "@", path: '"named"' }).path, '"@named"');
	// only one matching pair is removed
	assert.equal(quoteLocation({ location_type: "", path: "\"/a'" }).path, '"\\"/a\'"');
	assert.equal(quoteLocation({ location_type: "", path: '"' }).path, '"\\""');
});
