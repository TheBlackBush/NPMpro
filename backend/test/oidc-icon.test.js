import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, it } from "node:test";
import { checkIcon, detectIconType, downloadIcon, ICON_MAX_BYTES, ICON_MIME, svgIsSafe } from "../lib/oidc-icon.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]);
const svg = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>');

const TOO_LARGE = /too large/u;
const NOT_ALLOWED = /not allowed/u;
const UNSUPPORTED = /Unsupported icon type/u;
const TOO_MANY_REDIRECTS = /too many redirects/u;
const HTTP_ONLY = /http or https/u;
const HTTP_404 = /HTTP 404/u;
const BODY_TEXT = /secret/u;
const TIMED_OUT = /timed out/u;

const UNSAFE_SVG = [
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	"<svg><script>alert(1)</script></svg>",
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	'<svg onload="x()"></svg>',
	'<svg><a href="javascript:x()"/></svg>',
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	"<svg><SCRIPT>alert(1)</SCRIPT></svg>",
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	"<svg\nonclick='x()'></svg>",
	'<svg xmlns:s="http://www.w3.org/2000/svg"><s:script>x()</s:script></svg>',
	'<svg><a href="&#106;avascript:x()"/></svg>',
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	'<svg><a href="java&#x9;script:x()"/></svg>',
	'<svg><a href="java\tscript:x()"/></svg>',
	"<svg/onload=x()>",
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	'<svg a="1"onload="x()"></svg>',
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	"<svg><title>&custom;</title></svg>",
	'<?xml-stylesheet href="x.xsl" type="text/xsl"?><svg/>',
	// biome-ignore lint/security/noSecrets: unsafe SVG sample, not a secret
	"<svg><foreignObject><div/></foreignObject></svg>",
	'<svg><set attributeName="onmouseover" to="x()"/></svg>',
	'<svg><animate attributeName="onclick" values="x()"/></svg>',
	'<!DOCTYPE svg><!ENTITY a "b"><svg/>',
];

let server;
let base;

before(async () => {
	server = createServer((req, res) => {
		const path = req.url;
		if (path === "/icon.png") {
			res.writeHead(200, { "Content-Type": "image/png" });
			res.end(png);
		} else if (path.startsWith("/hop/")) {
			const n = Number(path.slice(5));
			res.writeHead(302, { Location: n > 0 ? `/hop/${n - 1}` : "/icon.png" });
			res.end();
		} else if (path === "/ftp") {
			res.writeHead(302, { Location: "ftp://example.com/icon.png" });
			res.end();
		} else if (path === "/missing") {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("secret body text");
		} else if (path === "/big") {
			res.writeHead(200, { "Content-Type": "image/png" });
			res.end(Buffer.alloc(ICON_MAX_BYTES + 10, 0x89));
		} else if (path === "/big-stream") {
			res.writeHead(200, { "Content-Type": "image/png" });
			const chunk = Buffer.alloc(64 * 1024, 0x89);
			let sent = 0;
			const send = () => {
				if (sent >= 10 || res.destroyed) return res.end();
				sent++;
				res.write(chunk, send);
			};
			send();
		} else if (path === "/slow") {
			res.writeHead(200, { "Content-Type": "image/png" });
			res.write(png.subarray(0, 4));
		} else {
			res.writeHead(500);
			res.end();
		}
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
	server.closeAllConnections();
	server.close();
});

it("detects the four allowed types by content", () => {
	assert.equal(detectIconType(png), "png");
	assert.equal(detectIconType(jpg), "jpg");
	assert.equal(detectIconType(webp), "webp");
	assert.equal(detectIconType(svg), "svg");
	assert.equal(detectIconType(Buffer.from("<html><body>")), null);
	assert.equal(detectIconType(Buffer.from("GIF89a")), null);
});

it("detects svg after a bom, comments and a doctype", () => {
	const text = '﻿  <?xml version="1.0"?><!-- c --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg/>';
	assert.equal(detectIconType(Buffer.from(text)), "svg");
	assert.equal(detectIconType(Buffer.from("<svgx>")), null);
	assert.equal(detectIconType(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0xfe])), null);
	assert.equal(detectIconType(Buffer.alloc(0)), null);
	assert.equal(detectIconType(undefined), null);
});

it("refuses scripted svg", () => {
	for (const unsafe of UNSAFE_SVG) assert.equal(svgIsSafe(unsafe), false, unsafe);
	assert.equal(svgIsSafe('<svg><path d="M0 0"/></svg>'), true);
	assert.equal(
		svgIsSafe(
			'<svg><title>Tom &amp; Jerry &lt;3 &quot;&apos;&gt;</title><set attributeName="fill" to="red"/></svg>',
		),
		true,
	);
});

it("only accepts a real xml declaration before the svg", () => {
	assert.equal(detectIconType(Buffer.from('<?xml-stylesheet href="x.xsl"?><svg/>')), null);
	assert.equal(detectIconType(Buffer.from("<?xmlfoo ?><svg/>")), null);
	assert.equal(detectIconType(Buffer.from('<?xml version="1.0"?><svg/>')), "svg");
});

it("refuses large files and unsafe svg with a reason", () => {
	assert.throws(() => checkIcon(Buffer.alloc(256 * 1024 + 1, 0x89)), TOO_LARGE);
	assert.throws(() => checkIcon(Buffer.from(UNSAFE_SVG[1])), NOT_ALLOWED);
	assert.throws(() => checkIcon(Buffer.from("GIF89a")), UNSUPPORTED);
	assert.throws(() => checkIcon(undefined), UNSUPPORTED);
	assert.equal(checkIcon(png), "png");
	assert.equal(checkIcon(svg), "svg");
});

it("maps every type to a mime type", () => {
	assert.equal(ICON_MAX_BYTES, 256 * 1024);
	assert.deepEqual(ICON_MIME, {
		png: "image/png",
		jpg: "image/jpeg",
		webp: "image/webp",
		svg: "image/svg+xml",
	});
});

it("downloads an icon", async () => {
	assert.deepEqual(await downloadIcon(`${base}/icon.png`), png);
});

it("follows at most three redirects", async () => {
	assert.deepEqual(await downloadIcon(`${base}/hop/2`), png);
	await assert.rejects(downloadIcon(`${base}/hop/3`), TOO_MANY_REDIRECTS);
});

it("refuses other protocols, also after a redirect", async () => {
	await assert.rejects(downloadIcon("ftp://example.com/icon.png"), HTTP_ONLY);
	await assert.rejects(downloadIcon("file:///etc/passwd"), HTTP_ONLY);
	await assert.rejects(downloadIcon("not a url"), HTTP_ONLY);
	await assert.rejects(downloadIcon(`${base}/ftp`), HTTP_ONLY);
});

it("reports the status without the response body", async () => {
	await assert.rejects(downloadIcon(`${base}/missing`), (err) => {
		assert.match(err.message, HTTP_404);
		assert.doesNotMatch(err.message, BODY_TEXT);
		return true;
	});
});

it("cuts off large downloads", async () => {
	await assert.rejects(downloadIcon(`${base}/big`), TOO_LARGE);
	await assert.rejects(downloadIcon(`${base}/big-stream`), TOO_LARGE);
});

it("times out", async () => {
	await assert.rejects(downloadIcon(`${base}/slow`, 200), TIMED_OUT);
});
