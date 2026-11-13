import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { DEFAULT_TIMEFMT, ECHO_VARS, fillPlaceholders, ssiProblems } from "../lib/landing-pages/placeholders.js";

const NOW = new Date(Date.UTC(2026, 10, 13, 9, 41, 7));
const VALUES = { remote_addr: "203.0.113.7", status: 502, host: "example.com", now: NOW };

it("allows the echo of the five values and config timefmt", () => {
	const html = [
		'<!--# echo var="remote_addr" -->',
		'<!--# echo var="host" default="" encoding="entity" -->',
		'<!--# echo var="status" default="404" -->',
		'<!--# config timefmt="%Y-%m-%d %H:%M UTC" --><!--# echo var="date_gmt" -->',
		'<!--# echo var="date_local" -->',
	].join("\n");
	assert.deepEqual(ssiProblems(html), []);
	assert.deepEqual(ssiProblems("<p>no commands</p><!-- a plain comment -->"), []);
});

it("refuses every other command, variable, attribute, encoding and malformed command", () => {
	const refused = [
		'<!--# include virtual="/" -->',
		'<!--# include file="footer.html" -->',
		'<!--# set var="a" value="b" -->',
		'<!--# if expr="$a" -->',
		'<!--# echo var="http_cookie" -->',
		'<!--# echo var="remote_addr" encoding="none" -->',
		'<!--# echo var="remote_addr" foo="bar" -->',
		'<!--# config errmsg="x" -->',
		'<!--# config timefmt="%c" -->',
		"<!--# echo var='remote_addr' -->",
		'<!--# ECHO var="remote_addr" -->',
		"<!--#",
	];
	for (const html of refused) assert.ok(ssiProblems(html).length > 0, html);
});

it("fills the values HTML-escaped, with the timefmt of the page or nginx's default", () => {
	const html =
		'IP <!--# echo var="remote_addr" --> <!--# config timefmt="%Y-%m-%d %H:%M UTC" --><!--# echo var="date_gmt" --> <!--# echo var="status" --> <!--# echo var="host" -->';
	assert.equal(fillPlaceholders(html, VALUES), "IP 203.0.113.7 2026-11-13 09:41 UTC 502 example.com");
	assert.equal(fillPlaceholders('<!--# echo var="date_gmt" -->', VALUES), "Friday, 13-Nov-2026 09:41:07 UTC");
	assert.equal(DEFAULT_TIMEFMT, "%A, %d-%b-%Y %H:%M:%S %Z");
	assert.equal(
		fillPlaceholders('<!--# echo var="host" -->', { ...VALUES, host: '<b a="1">&' }),
		"&lt;b a=&quot;1&quot;&gt;&amp;",
	);
});

it("uses default for an empty value and drops what is not allowed", () => {
	assert.equal(fillPlaceholders('<!--# echo var="host" default="none" -->', { ...VALUES, host: "" }), "none");
	assert.equal(fillPlaceholders('a<!--# include virtual="/" -->b', VALUES), "ab");
	assert.equal(fillPlaceholders('a<!--# echo var="http_cookie" -->b', VALUES), "ab");
});

it("npmpro_pages.lua knows the same variables and default timefmt", () => {
	const lua = readFileSync(new URL("../../rootfs/usr/local/share/lua/5.1/npmpro_pages.lua", import.meta.url), "utf8");
	for (const name of ECHO_VARS) assert.ok(lua.includes(`values.var == "${name}"`), name);
	assert.ok(lua.includes(`local DEFAULT_TIMEFMT = "${DEFAULT_TIMEFMT}"`));
	const conf = readFileSync(
		new URL("../../rootfs/usr/local/nginx/conf/crowdsec-bouncer.conf", import.meta.url),
		"utf8",
	);
	assert.ok(
		conf.includes(
			'require("npmpro_pages").wrap(require "plugins.crowdsec.ban", require "plugins.crowdsec.captcha")',
		),
	);
	assert.ok(conf.includes("pcall(function()"), "the wrap call is guarded");
	assert.ok(lua.includes("pcall(M.fill"), "the fill is guarded");
	const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");
	for (const file of ["ban", "captcha"]) {
		assert.match(
			dockerfile,
			new RegExp(`"[0-9a-f]{64}" /src/lua-cs-bouncer/lib/plugins/crowdsec/${file}\\.lua`, "u"),
			file,
		);
	}
	assert.ok(dockerfile.includes("| sha256sum -c"));
});
