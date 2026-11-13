import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, it } from "node:test";
import { importLegacyPage, importLegacyPages, legacyPagePaths, readLegacyPage } from "../lib/landing-pages/legacy.js";

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
const deps = {
	log,
	at: (file) => file,
	get root() {
		return dir;
	},
	stockOf: () => at("stock.html"),
};

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

it("a file that is not a page is left where it is and logged by its path only", async () => {
	logs.length = 0;
	await writeFile(at("cert.pem"), "SECRET-CONTENT");
	assert.deepEqual(await importLegacyPage("ban", at("cert.pem"), deps), { choice: "npmpro", html: "" });
	assert.equal(await readFile(at("cert.pem"), "utf8"), "SECRET-CONTENT");
	await writeFile(at("big.html"), "a".repeat(1024 * 1024 + 1));
	await importLegacyPage("ban", at("big.html"), deps);
	assert.ok((await stat(at("big.html"))).isFile());
	const outside = await mkdtemp(path.join(os.tmpdir(), "legacy-outside-"));
	await writeFile(path.join(outside, "x.html"), "<p>x</p>");
	await symlink(outside, at("folder-link"));
	await importLegacyPage("ban", at("folder-link/x.html"), deps);
	assert.ok((await stat(path.join(outside, "x.html"))).isFile());
	await rm(outside, { recursive: true, force: true });
	assert.ok(logs.every(([, text]) => !text.includes("SECRET-CONTENT")));
	assert.ok(logs.filter(([level]) => level === "warn").length >= 3);
});

it("reading changes nothing, the move happens in finish() after the row is saved", async () => {
	await writeFile(at("keep.html"), "<p>mine</p>");
	const { page, finish } = await readLegacyPage("ban", at("keep.html"), deps);
	assert.deepEqual(page, { choice: "custom", html: "<p>mine</p>" });
	assert.ok((await stat(at("keep.html"))).isFile());
	await finish();
	await assert.rejects(stat(at("keep.html")));
	assert.equal(await readFile(at("keep.html.before-pages"), "utf8"), "<p>mine</p>");
	assert.ok(logs.some(([, text]) => text.includes("keep.html.before-pages")));
});

it("importLegacyPages saves the row before it moves any file", async () => {
	const order = [];
	await importLegacyPages({
		log,
		save: async () => order.push("save"),
		readCrowdsec: async () => ({}),
		fs: { lstat: async () => null, readFile: async () => "" },
	});
	assert.deepEqual(order, ["save"]);
});
