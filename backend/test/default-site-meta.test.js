import assert from "node:assert/strict";
import { it } from "node:test";
import { assertDefaultSiteMeta } from "../lib/default-site.js";

it("accepts absolute redirect URLs and HTTP status codes", () => {
	for (const meta of [
		{ redirect: "https://example.com" },
		{ redirect: "http://example.com/path?x=1" },
		{ redirect: "https://example.com$request_uri" },
		{ status: 404 },
		{ status: "503" },
		{ redirect: "", status: "" },
		{ html: "<h1>hi</h1>" },
	]) {
		assert.doesNotThrow(() => assertDefaultSiteMeta(meta), JSON.stringify(meta));
	}
});

it("refuses redirects and statuses that would change the nginx config", () => {
	for (const meta of [
		{ redirect: "example.com" },
		{ redirect: "https://example.com; return 200" },
		{ redirect: "https://example.com/ x" },
		{ redirect: 'https://example.com/"' },
		{ redirect: "https://example.com/{x}" },
		{ redirect: "javascript:alert(1)" },
		{ status: "200; root /" },
		{ status: 99 },
		{ status: 600 },
	]) {
		assert.throws(() => assertDefaultSiteMeta(meta), { status: 400 }, JSON.stringify(meta));
	}
});
