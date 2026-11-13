import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { importLegacyPage, legacyPagePaths } from "../lib/landing-pages/legacy.js";

let dir;
const logs = [];
const log = { info: (text) => logs.push(["info", text]), warn: (text) => logs.push(["warn", text]) };
const STOCK = "<html>stock ban</html>";

before(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "legacy-pages-"));
	await writeFile(path.join(dir, "stock.html"), STOCK);
});
after(() => rm(dir, { recursive: true, force: true }));

// the files of the test, at their own paths: the import gets the full paths through `at`
const at = (name) => path.join(dir, name);
const deps = { log, at: (file) => file, stockOf: () => at("stock.html") };

it("reads the old paths: the item 30 row, else crowdsec.conf, else the defaults; only files under /data/", () => {
	assert.deepEqual(legacyPagePaths({ stored: null, lines: {} }), {
		ban: "/data/crowdsec/ban.html",
		captcha: "/data/crowdsec/captcha.html",
	});
	assert.deepEqual(
		legacyPagePaths({
			stored: { ban_template_path: "/data/crowdsec/my-ban.html" },
			lines: { CAPTCHA_TEMPLATE_PATH: "/data/x.html" },
		}).ban,
		"/data/crowdsec/my-ban.html",
	);
	assert.equal(
		legacyPagePaths({ stored: null, lines: { CAPTCHA_TEMPLATE_PATH: "/data/pages/c.html" } }).captcha,
		"/data/pages/c.html",
	);
	assert.equal(
		legacyPagePaths({ stored: null, lines: { BAN_TEMPLATE_PATH: "/etc/passwd" } }).ban,
		"/data/crowdsec/ban.html",
	);
	assert.equal(
		legacyPagePaths({ stored: null, lines: { BAN_TEMPLATE_PATH: "/data/../etc/passwd" } }).ban,
		"/data/crowdsec/ban.html",
	);
	assert.equal(legacyPagePaths({ stored: { ban_template_path: "" }, lines: {} }).ban, "/data/crowdsec/ban.html");
});

it("a stock page is removed, the NPMpro page takes over", async () => {
	await writeFile(at("ban.html"), STOCK);
	assert.deepEqual(await importLegacyPage("ban", at("ban.html"), deps), { choice: "npmpro", html: "" });
	await assert.rejects(stat(at("ban.html")));
});

it("a hand-edited page becomes the custom page and is kept as .before-pages", async () => {
	await writeFile(at("captcha.html"), "<p>{{captcha_site_key}} mine</p>");
	const page = await importLegacyPage("captcha", at("captcha.html"), deps);
	assert.deepEqual(page, { choice: "custom", html: "<p>{{captcha_site_key}} mine</p>" });
	assert.equal(await readFile(at("captcha.html.before-pages"), "utf8"), "<p>{{captcha_site_key}} mine</p>");
	await assert.rejects(stat(at("captcha.html")));
	// a second one does not overwrite the first copy
	await writeFile(at("captcha.html"), "<p>again</p>");
	await importLegacyPage("captcha", at("captcha.html"), deps);
	assert.equal(await readFile(at("captcha.html.before-pages-2"), "utf8"), "<p>again</p>");
});

it("a page the checks refuse is kept as a file and named in the log; a link and a missing file are skipped", async () => {
	await writeFile(at("ban.html"), '<!--# include virtual="/" -->');
	assert.deepEqual(await importLegacyPage("ban", at("ban.html"), deps), { choice: "npmpro", html: "" });
	assert.ok(logs.some(([level, text]) => level === "warn" && text.includes("ban.html.before-pages")));
	await symlink(at("stock.html"), at("link.html"));
	assert.deepEqual(await importLegacyPage("ban", at("link.html"), deps), { choice: "npmpro", html: "" });
	assert.ok((await stat(at("link.html"))).isFile());
	assert.deepEqual(await importLegacyPage("ban", at("nothing.html"), deps), { choice: "npmpro", html: "" });
});
