import assert from "node:assert/strict";
import { it } from "node:test";
import { assertPageFields, MAX_PAGE_BYTES, pageHtmlProblems } from "../lib/landing-pages/html.js";
import {
	auditPageHtml,
	PLACES,
	pageFile,
	withoutPageHtml,
	withoutRelatedPageHtml,
} from "../lib/landing-pages/types.js";

it("checks size in UTF-8 bytes, well-formed text, NUL and SSI", () => {
	assert.deepEqual(pageHtmlProblems("<h1>ok</h1>"), []);
	assert.deepEqual(pageHtmlProblems("a".repeat(MAX_PAGE_BYTES)), []);
	assert.ok(pageHtmlProblems("a".repeat(MAX_PAGE_BYTES + 1)).length > 0);
	// 2 bytes per character in UTF-8: half the characters already fill the limit
	assert.ok(pageHtmlProblems("é".repeat(MAX_PAGE_BYTES / 2 + 1)).length > 0);
	assert.ok(pageHtmlProblems("a\ud800b").length > 0);
	assert.ok(pageHtmlProblems("a\u0000b").length > 0);
	assert.ok(pageHtmlProblems('<!--# include virtual="/" -->').length > 0);
	assert.ok(pageHtmlProblems("   ").length > 0);
});

it("a custom choice needs a page, any page sent is checked", () => {
	assert.throws(
		() => assertPageFields("proxy_host", { npmpro_page_upstream: "custom" }, {}),
		/npmpro_page_upstream_html/u,
	);
	assert.throws(
		() =>
			assertPageFields(
				"dead_host",
				{ npmpro_page_html: '<!--# echo var="http_cookie" -->' },
				{ npmpro_page: "global" },
			),
		/npmpro_page_html/u,
	);
	assert.doesNotThrow(() =>
		assertPageFields("access_list", { npmpro_denied_page: "custom", npmpro_denied_page_html: "<p>no</p>" }, {}),
	);
	// the saved page counts when the payload does not send one
	assert.doesNotThrow(() =>
		assertPageFields(
			"proxy_host",
			{ npmpro_page_maintenance: "custom" },
			{ npmpro_page_maintenance_html: "<p>soon</p>" },
		),
	);
	assert.doesNotThrow(() => assertPageFields("proxy_host", {}, {}));
});

it("maps a choice to the file nginx serves", () => {
	assert.equal(
		pageFile("upstream_error", "global", "proxy_host", 7),
		"/data/public/pages/global/upstream-error.html",
	);
	assert.equal(
		pageFile("upstream_error", "npmpro", "proxy_host", 7),
		"/usr/local/nginx/html/npmpro/upstream-error.html",
	);
	assert.equal(pageFile("not_found", "custom", "dead_host", 3), "/data/public/pages/dead-host-3/404.html");
	assert.equal(pageFile("denied", "custom", "access_list", 2), "/data/public/pages/access-list-2/denied.html");
	assert.equal(pageFile("upstream_error", "upstream", "proxy_host", 7), "");
	assert.equal(pageFile("denied", "plain", "access_list", 2), "");
	assert.deepEqual(
		PLACES.proxy_host.fields.map(({ column, default: value }) => [column, value]),
		[
			["npmpro_page_not_found", "upstream"],
			["npmpro_page_upstream", "global"],
			["npmpro_page_maintenance", "global"],
		],
	);
});

it("lists leave the HTML out, the audit log keeps only its size", () => {
	const row = {
		id: 1,
		npmpro_page_upstream: "custom",
		npmpro_page_upstream_html: "<p>é</p>",
		npmpro_page_not_found_html: "",
	};
	assert.deepEqual(auditPageHtml(row), { ...row, npmpro_page_upstream_html: "(9 bytes)" });
	assert.equal(row.npmpro_page_upstream_html, "<p>é</p>");
	assert.deepEqual(withoutPageHtml({ ...row }), { id: 1, npmpro_page_upstream: "custom" });
	// a proxy host list expands its access lists, whose denied pages are HTML too
	const listed = withoutPageHtml({
		id: 2,
		access_lists: [{ id: 3, npmpro_denied_page_html: "<p>x</p>" }],
		locations: [{ access_lists: [{ npmpro_denied_page_html: "y" }] }],
	});
	assert.deepEqual(listed, { id: 2, access_lists: [{ id: 3 }], locations: [{ access_lists: [{}] }] });
});

it("expanded hosts and access lists lose their HTML, also in a host's own answer and its audit entry", () => {
	// a certificate list expands its hosts
	const certificate = withoutPageHtml({
		id: 1,
		dead_hosts: [{ id: 2, npmpro_page_html: "<p>d</p>" }],
		mtls_proxy_hosts: [{ id: 3, npmpro_page_upstream_html: "<p>p</p>" }],
		mtls_dead_hosts: [{ id: 4, npmpro_page_html: "<p>m</p>" }],
	});
	assert.deepEqual(certificate, {
		id: 1,
		dead_hosts: [{ id: 2 }],
		mtls_proxy_hosts: [{ id: 3 }],
		mtls_dead_hosts: [{ id: 4 }],
	});
	const host = () => ({
		id: 5,
		npmpro_page_upstream_html: "<p>own</p>",
		access_lists: [{ id: 6, npmpro_denied_page_html: "<p>x</p>" }],
		locations: [{ access_lists: [{ id: 6, npmpro_denied_page_html: "<p>x</p>" }] }],
	});
	assert.deepEqual(withoutRelatedPageHtml(host()), {
		id: 5,
		npmpro_page_upstream_html: "<p>own</p>",
		access_lists: [{ id: 6 }],
		locations: [{ access_lists: [{ id: 6 }] }],
	});
	const row = host();
	assert.deepEqual(auditPageHtml(row), {
		id: 5,
		npmpro_page_upstream_html: "(10 bytes)",
		access_lists: [{ id: 6 }],
		locations: [{ access_lists: [{ id: 6 }] }],
	});
	// the row itself keeps its relations' pages (the config is rendered from it)
	assert.deepEqual(row, host());
});
