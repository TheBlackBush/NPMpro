import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";

let api;
let admin;
const STOCK_BAN = "<html>stock ban page</html>";

before(async () => {
	// an install from before: the stock ban page and a hand-edited captcha page, the stock copies of the image
	api = await startApi({
		files: {
			"/etc/ban.html.original": STOCK_BAN,
			"/etc/captcha.html.original": "<html>stock captcha</html>",
			"/data/crowdsec/ban.html": STOCK_BAN,
			"/data/crowdsec/captcha.html": "<html>my captcha {{captcha_site_key}}</html>",
		},
	});
	admin = await api.admin();
});
after(() => api?.stop());

it("the first start imported the old CrowdSec pages and wrote the global files", async () => {
	const res = await admin.get("/settings/landing-pages");
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.pages.ban, { choice: "npmpro", html: "" });
	assert.deepEqual(res.body.pages.captcha, {
		choice: "custom",
		html: "<html>my captcha {{captcha_site_key}}</html>",
	});
	assert.equal(res.body.default_site.value, "congratulations");
	await assert.rejects(api.read("/data/crowdsec/ban.html"));
	assert.equal(
		await api.read("/data/crowdsec/captcha.html.before-pages"),
		"<html>my captcha {{captcha_site_key}}</html>",
	);
	assert.equal(
		await api.read("/data/public/pages/global/captcha.html"),
		"<html>my captcha {{captcha_site_key}}</html>",
	);
	assert.match(await api.read("/data/public/pages/global/upstream-error.html"), /Site unavailable/u);
	assert.match(
		await api.read("/data/crowdsec/crowdsec.conf"),
		/^CAPTCHA_TEMPLATE_PATH=\/data\/public\/pages\/global\/captcha\.html$/mu,
	);
});

it("saves a custom page, checks it, writes the file, tests and reloads nginx", async () => {
	await api.outside.clearCalls();
	const res = await admin.put("/settings/landing-pages", {
		pages: { upstream_error: { choice: "custom", html: "<p>down</p>" } },
	});
	assert.equal(res.status, 200);
	assert.deepEqual(res.body.pages.upstream_error, { choice: "custom", html: "<p>down</p>" });
	assert.equal(await api.read("/data/public/pages/global/upstream-error.html"), "<p>down</p>");
	assert.match((await api.outside.calls()).join("\n"), /nginx -tq/u);
	const empty = await admin.put("/settings/landing-pages", { pages: { maintenance: { choice: "custom" } } });
	assert.equal(empty.status, 400);
	const ssi = await admin.put("/settings/landing-pages", {
		pages: { maintenance: { choice: "custom", html: '<!--# set var="a" value="b" -->' } },
	});
	assert.equal(ssi.status, 400);
	const back = await admin.put("/settings/landing-pages", { pages: { upstream_error: { choice: "npmpro" } } });
	assert.equal(back.body.pages.upstream_error.html, "<p>down</p>");
	assert.match(await api.read("/data/public/pages/global/upstream-error.html"), /Site unavailable/u);
});

it("a failed nginx -t puts the files back and saves nothing", async () => {
	await api.outside.failCommand("nginx", "nginx: [emerg] test failure");
	const res = await admin.put("/settings/landing-pages", {
		pages: { not_found: { choice: "custom", html: "<p>lost</p>" } },
	});
	await api.outside.passCommand("nginx");
	assert.equal(res.status, 400);
	assert.match(await api.read("/data/public/pages/global/404.html"), /Page not found/u);
	assert.equal((await admin.get("/settings/landing-pages")).body.pages.not_found.choice, "npmpro");
});

it("the default page moves through the same endpoint and the old route still answers", async () => {
	const res = await admin.put("/settings/landing-pages", { default_site: { value: "404", meta: {} } });
	assert.equal(res.status, 200);
	assert.equal(res.body.default_site.value, "404");
	assert.equal((await admin.get("/settings/default-site")).body.value, "404");
	assert.match(await api.read("/usr/local/nginx/conf/conf.d/default.conf"), /npmpro-page\/not-found/u);
	const old = await admin.put("/settings/default-site", { value: "congratulations", meta: {} });
	assert.equal(old.status, 200);
	assert.equal((await admin.get("/settings/landing-pages")).body.default_site.value, "congratulations");
});

it("admins only, the audit log names the types, the generic list hides the row", async () => {
	const user = await api.limited({ visibility: "all", access_lists: "manage" });
	assert.equal((await user.get("/settings/landing-pages")).status, 403);
	await admin.put("/settings/landing-pages", { pages: { ban: { choice: "custom", html: "<p>b</p>" } } });
	const audit = await admin.get("/audit-log");
	assert.deepEqual(audit.body[0].meta, { id: "landing_pages", changed: ["ban"] });
	assert.ok(!(await admin.get("/settings")).body.some((row) => row.id === "landing_pages"));
});

it("an empty html with the custom choice keeps the saved page, another choice clears it", async () => {
	await admin.put("/settings/landing-pages", { pages: { denied: { choice: "custom", html: "<p>no</p>" } } });
	const kept = await admin.put("/settings/landing-pages", { pages: { denied: { choice: "custom", html: "" } } });
	assert.equal(kept.status, 200);
	assert.deepEqual(kept.body.pages.denied, { choice: "custom", html: "<p>no</p>" });
	const cleared = await admin.put("/settings/landing-pages", { pages: { denied: { choice: "npmpro", html: "" } } });
	assert.deepEqual(cleared.body.pages.denied, { choice: "npmpro", html: "" });
});

it("a failure writing the global files at start is logged and does not throw", async () => {
	const { startLandingPages } = await import("../internal/landing-pages.js");
	const dir = path.join(api.root, "data/public/pages/global");
	await rm(dir, { recursive: true, force: true });
	await writeFile(dir, "not a folder");
	const errors = [];
	try {
		await startLandingPages({ log: { error: (text) => errors.push(text), info: () => {}, warn: () => {} } });
		assert.equal(errors.length, 1);
		assert.match(errors[0], /could not write the global pages/u);
	} finally {
		await rm(dir, { force: true });
		await mkdir(dir, { recursive: true });
		await startLandingPages();
	}
	assert.match(await api.read("/data/public/pages/global/404.html"), /Page not found/u);
});
