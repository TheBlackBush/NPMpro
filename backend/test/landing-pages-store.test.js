import assert from "node:assert/strict";
import { it } from "node:test";
import { globalPageFiles, removePlacePages, writePageFile, writePlacePages } from "../lib/landing-pages/files.js";
import { applyPagesUpdate, changedPageTypes, effectivePages } from "../lib/landing-pages/store.js";
import { PAGE_TYPES, pageFile } from "../lib/landing-pages/types.js";

// an in-memory fs/promises with the calls the files module makes
const memoryFs = (files = {}) => {
	const store = new Map(Object.entries(files));
	const calls = [];
	return {
		store,
		calls,
		readFile: async (file) => {
			if (!store.has(file)) throw Object.assign(new Error(`ENOENT ${file}`), { code: "ENOENT" });
			return store.get(file);
		},
		writeFile: async (file, content) => {
			calls.push(["write", file]);
			store.set(file, content);
		},
		rename: async (from, to) => {
			calls.push(["rename", from, to]);
			store.set(to, store.get(from));
			store.delete(from);
		},
		chmod: async (file, mode) => calls.push(["chmod", file, mode]),
		mkdir: async (dir) => calls.push(["mkdir", dir]),
		rm: async (target) => {
			calls.push(["rm", target]);
			for (const key of [...store.keys()]) if (key === target || key.startsWith(`${target}/`)) store.delete(key);
		},
	};
};

it("defaults to the NPMpro page and falls back from a custom choice without a page", () => {
	const pages = effectivePages(null);
	assert.deepEqual(Object.keys(pages), PAGE_TYPES);
	for (const type of PAGE_TYPES) assert.deepEqual(pages[type], { choice: "npmpro", html: "" });
	const stored = {
		pages: {
			ban: { choice: "custom", html: "<p>b</p>" },
			captcha: { choice: "custom", html: "" },
			maintenance: { choice: "nope" },
		},
	};
	const effective = effectivePages(stored);
	assert.deepEqual(effective.ban, { choice: "custom", html: "<p>b</p>" });
	assert.equal(effective.captcha.choice, "npmpro");
	assert.equal(effective.maintenance.choice, "npmpro");
});

it("an update changes the sent types only and keeps a page when only the choice changes", () => {
	const stored = { pages: { ban: { choice: "custom", html: "<p>b</p>" } }, imported_on: "x" };
	const next = applyPagesUpdate(stored, {
		ban: { choice: "npmpro" },
		not_found: { choice: "custom", html: "<p>n</p>" },
		nope: {},
	});
	assert.deepEqual(next, {
		pages: { ban: { choice: "npmpro", html: "<p>b</p>" }, not_found: { choice: "custom", html: "<p>n</p>" } },
		imported_on: "x",
	});
	assert.deepEqual(changedPageTypes(effectivePages(stored), effectivePages(next)), ["not_found", "ban"]);
});

it("global files: the custom page or the built-in page", async () => {
	const fs = memoryFs();
	for (const type of PAGE_TYPES) {
		const name = type === "not_found" ? "404" : type.replace("_", "-");
		fs.store.set(`/usr/local/nginx/html/npmpro/${name}.html`, `built-in ${type}`);
	}
	const pages = effectivePages({ pages: { ban: { choice: "custom", html: "<p>mine</p>" } } });
	const files = await globalPageFiles(pages, { fs });
	assert.equal(files.length, 7);
	assert.deepEqual(files.find((file) => file.path.endsWith("/global/ban.html")).content, "<p>mine</p>");
	assert.equal(files.find((file) => file.path.endsWith("/global/404.html")).content, "built-in not_found");
});

it("a place's files: written for custom choices, removed otherwise", async () => {
	const fs = memoryFs();
	await writePlacePages(
		"proxy_host",
		{
			id: 4,
			npmpro_page_upstream: "custom",
			npmpro_page_upstream_html: "<p>u</p>",
			npmpro_page_not_found: "custom",
			npmpro_page_not_found_html: "",
			npmpro_page_maintenance_html: "",
		},
		{ fs },
	);
	assert.equal(fs.store.get("/data/public/pages/proxy-host-4/upstream-error.html"), "<p>u</p>");
	assert.ok(!fs.store.has("/data/public/pages/proxy-host-4/404.html"));
	assert.ok(
		fs.calls.some(
			([call, file, mode]) => call === "chmod" && file.includes("upstream-error.html") && mode === 0o644,
		),
	);
	await writePlacePages(
		"proxy_host",
		{
			id: 4,
			npmpro_page_upstream: "global",
			npmpro_page_upstream_html: "<p>u</p>",
			npmpro_page_not_found_html: "",
			npmpro_page_maintenance_html: "",
		},
		{ fs },
	);
	assert.ok(fs.calls.some(([call, target]) => call === "rm" && target === "/data/public/pages/proxy-host-4"));
	await removePlacePages("access_list", 9, { fs });
	assert.deepEqual(fs.calls.at(-1), ["rm", "/data/public/pages/access-list-9"]);
});

it("a page is written to a temporary file and renamed, and the temporary file goes on a failure", async () => {
	const fs = memoryFs();
	await writePageFile("/data/public/pages/global/ban.html", "<p>x</p>", { fs });
	assert.deepEqual(
		fs.calls.map(([call]) => call),
		["write", "chmod", "rename"],
	);
	assert.equal(fs.store.get("/data/public/pages/global/ban.html"), "<p>x</p>");
	assert.equal(fs.store.size, 1);
	fs.rename = async () => {
		throw new Error("boom");
	};
	await assert.rejects(writePageFile("/data/public/pages/global/ban.html", "<p>y</p>", { fs }), /boom/u);
	assert.equal(fs.store.size, 1);
	assert.equal(fs.store.get("/data/public/pages/global/ban.html"), "<p>x</p>");
});

it("a row without its page HTML columns is refused and nothing is removed", async () => {
	const fs = memoryFs();
	await assert.rejects(
		writePlacePages("proxy_host", { id: 4, npmpro_page_upstream: "custom" }, { fs }),
		/full saved row/u,
	);
	assert.equal(fs.calls.length, 0);
});

it("an id that is not a positive integer never reaches a path", async () => {
	const fs = memoryFs();
	for (const id of ["1/../..", "../x", undefined, 0, -1, 1.5, "4"]) {
		await assert.rejects(removePlacePages("access_list", id, { fs }), /Invalid id/u);
		assert.throws(() => pageFile("denied", "custom", "access_list", id), /Invalid id/u);
	}
	assert.throws(() => pageFile("denied", "custom", "nope", 1), /Unknown page place/u);
	assert.throws(() => pageFile("nope", "global", "access_list", 1), /Unknown page type/u);
	assert.equal(fs.calls.length, 0);
});
