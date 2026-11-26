import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, makeT, renderMail, TEMPLATES } from "../mail/render.js";

const LINE_BREAK = /[\r\n]/u;
const SUBJECT_PATTERN = /^\[NPMpro .+\] Test mail$/u;
const URLS = /https?:\/\/[^"]*/gu;
const EN_LINES = ["This is a test mail from NPMpro at box.example.", "If you got it, mail works."];
const FOOTER = "Sent by NPMpro at box.example.";

describe("mail templates", () => {
	it("renders every line in both parts", () => {
		const mail = renderMail("test", { language: "en", instance: "box.example" });
		assert.equal(mail.subject, "[NPMpro box.example] Test mail");
		for (const line of [...EN_LINES, FOOTER]) {
			assert.ok(mail.text.includes(line), line);
			assert.ok(mail.html.includes(line), line);
		}
	});

	it("escapes a value in the HTML and keeps it plain in the text", () => {
		const value = `<b>"x"&'`;
		const mail = renderMail("test", { language: "en", instance: value });
		assert.ok(mail.text.includes(`mail from NPMpro at ${value}.`));
		assert.ok(mail.html.includes("&lt;b&gt;&quot;x&quot;&amp;&#39;"));
		assert.ok(!mail.html.includes("<b>"));
		assert.equal(escapeHtml(value), "&lt;b&gt;&quot;x&quot;&amp;&#39;");
	});

	it("keeps a subject on one line", () => {
		const mail = renderMail("test", { instance: "a\r\nBcc: x@example.com" });
		assert.ok(!LINE_BREAK.test(mail.subject));
	});

	it("has no image, script, source or link in the HTML, no URL in the text", () => {
		const mail = renderMail("test", { language: "de", instance: "box.example" });
		assert.ok(!mail.html.includes("<img"));
		assert.ok(!mail.html.includes("<script"));
		assert.ok(!mail.html.includes("src="));
		assert.ok(!mail.html.includes("http"));
		assert.ok(!mail.text.includes("http"));
	});

	it("adds the button as an anchor in the HTML and as label: url in the text, and the list", () => {
		TEMPLATES.sample = ({ t }) => ({
			subject: t("test.subject"),
			lines: ["Hello"],
			button: { label: "Open", url: 'https://npm.example/a?b=1&c="2"' },
			list: [{ text: "One", note: "n1" }, { text: "Two <3" }],
			footer: ["Bye"],
		});
		try {
			const mail = renderMail("sample", { instance: "i" });
			assert.ok(mail.text.includes('Open: https://npm.example/a?b=1&c="2"'));
			assert.ok(mail.text.includes("- One (n1)\n- Two <3"));
			assert.ok(mail.html.includes('<a href="https://npm.example/a?b=1&amp;c=&quot;2&quot;"'));
			assert.ok(mail.html.includes("Two &lt;3"));
			assert.equal(mail.html.match(URLS).length, 1);
		} finally {
			delete TEMPLATES.sample;
		}
	});

	it("uses the container host name without an instance and refuses an unknown template", () => {
		assert.match(renderMail("test", {}).subject, SUBJECT_PATTERN);
		assert.throws(() => renderMail("nope", {}), { message: "Unknown mail template nope" });
	});

	it("renders every language", () => {
		for (const code of ["de", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt", "ru", "uk", "zh"]) {
			const mail = renderMail("test", { language: code, instance: "box.example" });
			assert.ok(mail.text.includes("box.example"), code);
			assert.notEqual(mail.text, renderMail("test", { language: "en", instance: "box.example" }).text, code);
		}
	});

	it("falls back to English for an unknown language and, per key, for a missing key", () => {
		const english = renderMail("test", { language: "en", instance: "i" });
		assert.deepEqual(renderMail("test", { language: "xx", instance: "i" }), english);
		const tables = {
			en: { a: "Hello {name}", b: "English b" },
			de: { a: "Hallo {name}" },
		};
		const t = makeT("de", tables);
		assert.equal(t("a", { name: "X" }), "Hallo X");
		assert.equal(t("b"), "English b");
		assert.equal(t("c"), "c");
		assert.equal(t("a"), "Hallo {name}");
	});
});
