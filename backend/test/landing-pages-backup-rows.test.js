import assert from "node:assert/strict";
import { it } from "node:test";
import { withValidPages } from "../lib/landing-pages/backup-rows.js";

const BAD = '<!--# include virtual="/" -->';
const logs = () => {
	const lines = [];
	return { lines, warn: (text) => lines.push(text) };
};

it("leaves valid pages, empty pages, null and missing values alone", () => {
	const log = logs();
	const rows = {
		proxy_host: [
			{
				id: 1,
				npmpro_page_maintenance_html: "<p>ok</p>",
				npmpro_page_upstream_html: "",
				npmpro_page_not_found_html: null,
			},
			{ id: 2 },
		],
	};
	assert.deepEqual(withValidPages(rows, log), rows);
	assert.deepEqual(log.lines, []);
});

it("nulls a failing page of a proxy host, a 404 host and an access list, and logs the row and field only", () => {
	const log = logs();
	const out = withValidPages(
		{
			proxy_host: [{ id: 3, npmpro_page_maintenance_html: BAD }],
			dead_host: [{ id: 4, npmpro_page_html: BAD }],
			access_list: [{ id: 5, npmpro_denied_page_html: "   " }],
		},
		log,
	);
	assert.equal(out.proxy_host[0].npmpro_page_maintenance_html, null);
	assert.equal(out.dead_host[0].npmpro_page_html, null);
	assert.equal(out.access_list[0].npmpro_denied_page_html, null);
	assert.equal(log.lines.length, 3);
	assert.match(log.lines[0], /proxy_host #3 npmpro_page_maintenance_html/u);
	assert.equal(log.lines.join("\n").includes("include"), false);
});

it("treats a page that is not a string as failing", () => {
	for (const value of [5, {}, [], true, false]) {
		const log = logs();
		const out = withValidPages({ dead_host: [{ id: 1, npmpro_page_html: value }] }, log);
		assert.equal(out.dead_host[0].npmpro_page_html, null, JSON.stringify(value));
		assert.equal(log.lines.length, 1);
	}
	const log = logs();
	const meta = {
		pages: { ban: { choice: "custom", html: { a: 1 } }, captcha: { choice: "custom", html: "<p>x</p>" } },
	};
	const out = withValidPages({ setting: [{ id: "landing_pages", meta }] }, log);
	assert.deepEqual(out.setting[0].meta.pages.ban, { choice: "npmpro", html: "" });
	assert.deepEqual(out.setting[0].meta.pages.captcha, meta.pages.captcha);
});

it("takes the settings row meta as text too, and leaves other settings alone", () => {
	const log = logs();
	const meta = JSON.stringify({ pages: { ban: { choice: "custom", html: BAD } } });
	const other = { id: "oidc", meta: { pages: { ban: { html: BAD } } } };
	const out = withValidPages({ setting: [{ id: "landing_pages", meta }, other] }, log);
	assert.equal(out.setting[0].meta.pages.ban.choice, "npmpro");
	assert.equal(out.setting[1], other);
});

it("never writes backup-provided text into the log", () => {
	const log = logs();
	withValidPages(
		{
			proxy_host: [{ id: "1\nforged line", npmpro_page_maintenance_html: BAD }],
			setting: [{ id: "landing_pages", meta: { pages: { "evil\ntype": { html: BAD } } } }],
		},
		log,
	);
	assert.equal(log.lines.length, 2);
	assert.match(log.lines[0], /proxy_host #invalid id /u);
	assert.match(log.lines[1], /pages\.unknown\.html/u);
	for (const line of log.lines) assert.equal(/[\n\r]/u.test(line), false);
});
