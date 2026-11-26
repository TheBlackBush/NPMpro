import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { MAIL_LANGUAGES } from "../lib/mail/settings-rules.js";
import { renderMail, TEMPLATES } from "../mail/render.js";

const GOLDEN = JSON.parse(fs.readFileSync(new URL("./fixtures/mail-text-parts.json", import.meta.url), "utf8"));
const LINK = "https://box.example/reset-password#token=abc";
const HTML_LIMIT = 30 * 1024;
const REMOTE = /(?:src|url\(|href)\s*=?\s*["']?\s*(?:https?:)?\/\//iu;
const HOSTILE = `<script>alert("x")</script> 'q' & "d"`;
const ESCAPED = "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &#39;q&#39; &amp; &quot;d&quot;";
const URLS = /https?:\/\/[^\s"'<)]+/gu;

const withSample = (model, run) => {
	TEMPLATES.sample = () => model;
	try {
		return run(renderMail("sample", { instance: "i" }));
	} finally {
		delete TEMPLATES.sample;
	}
};

describe("the branded mail layout", () => {
	const reset = renderMail("reset-link", { language: "en", instance: "box.example", data: { link: LINK } });

	it("has the header, the logo, the gradient line, the heading, the preheader, the button, the fallback and the footer", () => {
		const { html } = reset;
		// the header colour also as a gradient, which the Gmail app keeps in dark mode
		assert.ok(html.includes("background:#0b1020;background-image:linear-gradient(#0b1020,#0b1020);"));
		assert.ok(html.includes('<img src="cid:logo@npmpro" width="168" height="69" alt="NPMpro"'));
		assert.ok(
			html.includes(
				"background:#d91aff;background-image:linear-gradient(90deg,#ff8a00,#ff2d55 30%,#d91aff 60%,#7a3bff 85%,#00d1ff)",
			),
		);
		assert.ok(html.includes('<h1 class="tx"'));
		assert.ok(html.includes(">Reset your NPMpro password</h1>"));
		assert.ok(html.includes("<title>Reset your NPMpro password</title>"));
		assert.ok(html.includes("display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;"));
		assert.ok(
			html.includes("Someone asked to reset the password of your NPMpro account at box.example.&zwnj;&nbsp;"),
		);
		assert.ok(html.includes('<td style="border-radius:8px;background:#7c3aed;padding:13px 26px;"><a href="'));
		assert.ok(html.includes("If the button does not work, open this link:<br>"));
		assert.ok(html.includes(`>${LINK}</a>`));
		assert.ok(html.includes("Sent by NPMpro at box.example.</p>"));
		assert.ok(html.includes('<meta name="color-scheme" content="light dark">'));
		assert.ok(html.includes('<meta name="supported-color-schemes" content="light dark">'));
		assert.ok(html.includes("prefers-color-scheme: dark"));
		assert.ok(html.includes("max-width:620px"));
		assert.ok(html.includes('role="presentation"'));
		assert.ok(!html.includes("<script"));
	});

	it("takes the heading without the instance prefix and keeps the prefix in the subject", () => {
		assert.equal(reset.subject, "[NPMpro box.example] Reset your NPMpro password");
		assert.ok(!reset.html.includes("[NPMpro box.example]"));
	});

	it("carries the logo once as an inline attachment with the cid of the img", () => {
		assert.equal(reset.attachments.length, 1);
		const [logo] = reset.attachments;
		assert.equal(logo.cid, "logo@npmpro");
		assert.equal(logo.contentDisposition, "inline");
		assert.equal(logo.contentType, "image/png");
		assert.equal(logo.filename, "npmpro-logo.png");
		assert.ok(Buffer.isBuffer(logo.content));
		assert.equal(logo.content.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
		assert.equal(logo.content.readUInt32BE(16), 336);
		assert.equal(logo.content.readUInt32BE(20), 138);
		assert.equal(reset.html.match(/cid:logo@npmpro/gu).length, 1);
	});

	it("has no remote resource besides the button link and the fallback link", () => {
		for (const mail of [reset, renderMail("test", { instance: "box.example" })]) {
			assert.ok(!REMOTE.test(mail.html.replace(/href="[^"]*"/gu, 'href="#"')));
			assert.ok(!mail.html.includes("url("));
			assert.ok(!mail.html.includes("@import"));
			assert.ok(!mail.html.includes("<link"));
		}
		const urls = reset.html.match(URLS).filter((url) => url !== "https://box.example/reset-password#token=abc");
		assert.deepEqual(urls, []);
		assert.equal(renderMail("test", { instance: "box.example" }).html.match(URLS), null);
	});

	it("escapes the instance, the lines, the list, the footer, the heading and the preheader", () => {
		const html = withSample(
			{
				subject: HOSTILE,
				lines: [HOSTILE, "second"],
				list: [{ text: HOSTILE, note: HOSTILE }],
				button: { label: HOSTILE, url: `https://npm.example/a?b="1"&c='2'` },
				footer: [HOSTILE],
			},
			(mail) => mail.html,
		);
		assert.ok(!html.includes("<script"));
		assert.ok(!html.includes('"x"'));
		assert.equal(html.split(ESCAPED).length - 1, 8);
		assert.ok(html.includes("<title>" + ESCAPED + "</title>"));
		assert.ok(
			html.includes(
				'opacity:0;color:transparent;mso-hide:all;font-size:1px;line-height:1px;">' + ESCAPED + "&zwnj;&nbsp;",
			),
		);
		assert.ok(html.includes("https://npm.example/a?b=&quot;1&quot;&amp;c=&#39;2&#39;"));
		const instance = renderMail("test", { instance: HOSTILE }).html;
		assert.ok(!instance.includes("<script"));
		assert.ok(instance.includes(ESCAPED));
	});

	it("styles the list block like the rest", () => {
		const html = withSample(
			{ subject: "s", lines: ["x"], list: [{ text: "One", note: "n" }, { text: "Two" }], footer: [] },
			(mail) => mail.html,
		);
		assert.ok(html.includes('<li class="tx"'));
		assert.ok(html.includes("One"));
		assert.ok(html.includes('<span class="mt"'));
	});

	it("keeps the HTML of the test mail and the reset link mail small", () => {
		for (const mail of [reset, renderMail("test", { instance: "box.example" })]) {
			assert.ok(Buffer.byteLength(mail.html) < HTML_LIMIT, String(Buffer.byteLength(mail.html)));
		}
	});

	it("leaves a mail without a button or a footer well formed", () => {
		const html = withSample({ subject: "s", lines: [], footer: [] }, (mail) => mail.html);
		assert.ok(html.includes('line-height:1px;">&zwnj;&nbsp;'));
		assert.ok(!html.includes("border-top"));
		assert.ok(!html.includes("If the button"));
	});

	it("keeps the plain text part of every template and language as before", () => {
		for (const language of MAIL_LANGUAGES) {
			const data = { link: LINK, time: "2026-11-26 18:40", ip: "203.0.113.7", count: 2 };
			const text = (id) => renderMail(id, { language, instance: "box.example", data }).text;
			assert.equal(text("test"), GOLDEN[`test-${language}`], `test ${language}`);
			assert.equal(text("reset-link"), GOLDEN[`reset-${language}`], `reset-link ${language}`);
			assert.equal(text("password-reset"), GOLDEN[`done-${language}`], `password-reset ${language}`);
		}
	});
});
