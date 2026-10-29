import assert from "node:assert/strict";
import { it } from "node:test";
import { applyDefaultSite } from "../lib/default-site.js";

// a fake internal/nginx.js plus the HTML page and save steps, all recorded in one list; test() fails while a
// "broken" row is written, reload() fails for a "bad-reload" row
const fake = ({ failSave = false, failHtml = false } = {}) => {
	const state = { written: { value: "congratulations" }, html: "old page", saved: false, steps: [], logged: [] };
	const nginx = {
		generateConfig: (_type, row) => {
			state.steps.push(`generate:${row?.value}`);
			state.written = row;
		},
		deleteConfig: () => {
			state.steps.push("delete");
			state.written = null;
		},
		test: () => {
			state.steps.push("test");
			if (state.written?.value === "broken") throw new Error("nginx: [emerg] broken");
		},
		reload: () => {
			state.steps.push("reload");
			if (state.written?.value === "bad-reload") throw new Error("reload failed");
		},
	};
	const steps = {
		writeHtml: (page) => {
			state.steps.push(`html:${page}`);
			if (failHtml) throw new Error("disk full");
			state.html = page;
		},
		save: () => {
			state.steps.push("save");
			if (failSave) throw new Error("database locked");
			state.saved = true;
		},
		logger: { warn: (msg) => state.logged.push(`warn:${msg}`), error: (msg) => state.logged.push(`error:${msg}`) },
	};
	return { nginx, steps, state };
};

const html = (page) => ({ value: "html", meta: { html: page } });

it("tests the config, writes the page, reloads and then saves", async () => {
	const { nginx, steps, state } = fake();
	await applyDefaultSite(nginx, html("new page"), { value: "404" }, steps);
	assert.deepEqual(state.steps, ["generate:html", "test", "html:new page", "reload", "save"]);
	assert.equal(state.saved, true);
	assert.deepEqual(state.logged, []);
});

it("writes no page outside the html mode", async () => {
	const { nginx, steps, state } = fake();
	await applyDefaultSite(nginx, { value: "404" }, html("old page"), steps);
	assert.deepEqual(state.steps, ["generate:404", "test", "reload", "save"]);
});

it("puts the previous config back, saves nothing and throws when nginx refuses the new one", async () => {
	const { nginx, steps, state } = fake();
	await assert.rejects(applyDefaultSite(nginx, { value: "broken" }, { value: "444" }, steps), (err) => {
		assert.equal(err.name, "ValidationError");
		assert.equal(err.cause.message, "nginx: [emerg] broken");
		return true;
	});
	assert.deepEqual(state.written, { value: "444" });
	assert.equal(state.saved, false);
	assert.deepEqual(state.steps, ["generate:broken", "test", "generate:444", "test", "reload"]);
});

it("restores the previous page and config when the reload fails", async () => {
	const { nginx, steps, state } = fake();
	const next = { value: "bad-reload" };
	await assert.rejects(applyDefaultSite(nginx, next, html("old page"), steps), { name: "ValidationError" });
	assert.equal(state.written.value, "html");
	assert.equal(state.saved, false);
});

it("restores the previous page and config when the save fails after the reload", async () => {
	const { nginx, steps, state } = fake({ failSave: true });
	await assert.rejects(applyDefaultSite(nginx, html("new page"), html("old page"), steps), (err) => {
		assert.equal(err.cause.message, "database locked");
		return true;
	});
	assert.deepEqual(state.steps, [
		"generate:html",
		"test",
		"html:new page",
		"reload",
		"save",
		"html:old page",
		"generate:html",
		"test",
		"reload",
	]);
	assert.equal(state.html, "old page");
	assert.equal(state.written.meta.html, "old page");
});

it("restores the previous config when the page can not be written", async () => {
	const { nginx, steps, state } = fake({ failHtml: true });
	await assert.rejects(applyDefaultSite(nginx, html("new page"), { value: "404" }, steps), (err) => {
		assert.equal(err.cause.message, "disk full");
		return true;
	});
	assert.deepEqual(state.written, { value: "404" });
	assert.equal(state.saved, false);
});

it("removes the default site config and logs it when the previous one fails too", async () => {
	const { nginx, steps, state } = fake();
	await assert.rejects(applyDefaultSite(nginx, { value: "broken" }, { value: "broken" }, steps), (err) => {
		assert.equal(err.name, "ValidationError");
		assert.equal(err.cause.message, "nginx: [emerg] broken");
		return true;
	});
	assert.equal(state.written, null);
	assert.deepEqual(state.steps, ["generate:broken", "test", "generate:broken", "test", "delete", "test", "reload"]);
	assert.equal(state.logged.length, 1);
	assert.ok(state.logged[0].startsWith("error:The saved default site config fails too"));
});

it("still throws the original failure when the restore fails as well", async () => {
	const { nginx, steps, state } = fake();
	nginx.reload = () => {
		state.steps.push("reload");
		throw new Error("control socket gone");
	};
	await assert.rejects(applyDefaultSite(nginx, { value: "404" }, { value: "444" }, steps), (err) => {
		assert.equal(err.name, "ValidationError");
		assert.equal(err.cause.message, "control socket gone");
		return true;
	});
	assert.equal(state.logged.length, 2);
	assert.ok(state.logged[1].startsWith("error:Could not reload nginx after restoring"));
});
