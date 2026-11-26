import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escapeHtml, makeT, renderMail, TEMPLATES } from "../mail/render.js";

const LINE_BREAK = /[\r\n]/u;
const SUBJECT_PATTERN = /^\[NPMpro .+\] Test mail$/u;
const SEPARATORS = ["\u2028", "\u2029", "\u0085", "\u0000", "\t"];
const ANCHORS = /<a href="[^"]*"/gu;
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

	it("has no script and no remote resource in the HTML, no URL in the text", () => {
		const mail = renderMail("test", { language: "de", instance: "box.example" });
		assert.ok(!mail.html.includes("<script"));
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
			assert.equal(mail.html.match(URLS).length, 3);
			assert.ok(mail.html.includes("If the button does not work, open this link:"));
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

	it("accepts only http and https button URLs", () => {
		const withUrl = (url) => {
			TEMPLATES.sample = () => ({ subject: "s", lines: ["x"], button: { label: "Go", url }, footer: [] });
			return renderMail("sample", { instance: "i" });
		};
		try {
			for (const bad of [
				"javascript:alert(1)",
				"data:text/html,x",
				"/relative/path",
				"npm.example/a",
				"",
				"ftp://x.example/",
			]) {
				assert.throws(
					() => withUrl(bad),
					{ message: "A mail button needs an absolute https or http URL" },
					bad,
				);
			}
			const quoted = withUrl('https://npm.example/a"onmouseover="x');
			assert.equal(quoted.html.match(ANCHORS).length, 1);
			assert.ok(!quoted.html.includes('"onmouseover'));
			assert.ok(withUrl("http://npm.example/").html.includes('href="http://npm.example/"'));
		} finally {
			delete TEMPLATES.sample;
		}
	});

	it("strips control and line separator characters from the subject and caps it", () => {
		const dirty = ["a", "b", "c", "d", "e", "f"].reduce((all, ch, i) => all + SEPARATORS[i - 1] + ch);
		const mail = renderMail("test", { instance: dirty });
		assert.equal(mail.subject, "[NPMpro a b c d e f] Test mail");
		assert.equal(renderMail("test", { instance: "x".repeat(500) }).subject.length, 200);
	});

	it("fills only own placeholders", () => {
		const t = makeT("en", { en: { a: "{constructor} {toString} {name}" } });
		assert.equal(t("a", { name: "n" }), "{constructor} {toString} n");
	});

	it("collapses line breaks in list text and notes in the text part", () => {
		TEMPLATES.sample = () => ({
			subject: "s",
			lines: ["x"],
			list: [{ text: "a\nb\r\nc", note: "n\u2028m" }],
			footer: [],
		});
		try {
			assert.ok(renderMail("sample", { instance: "i" }).text.includes("- a b c (n m)"));
		} finally {
			delete TEMPLATES.sample;
		}
	});

	it("declares the language and charset in the HTML", () => {
		const html = renderMail("test", { language: "de", instance: "i" }).html;
		assert.ok(html.includes('<html lang="de">'));
		assert.ok(html.includes('<meta charset="utf-8">'));
		assert.ok(renderMail("test", { language: "xx", instance: "i" }).html.includes('<html lang="en">'));
	});
});
