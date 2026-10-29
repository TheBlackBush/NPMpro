import assert from "node:assert/strict";
import { it } from "node:test";
import { applyDefaultSite } from "../lib/default-site.js";

// a fake internal/nginx.js: the written default config and the steps, test() fails while a "broken" row is written
const fakeNginx = ({ failReload = false } = {}) => {
	const nginx = {
		written: { value: "congratulations" },
		steps: [],
		generateConfig: (_type, row) => {
			nginx.steps.push(`generate:${row?.value}`);
			nginx.written = row;
		},
		deleteConfig: () => {
			nginx.steps.push("delete");
			nginx.written = null;
		},
		test: () => {
			nginx.steps.push("test");
			if (nginx.written?.value === "broken") throw new Error("nginx: [emerg] broken");
		},
		reload: () => {
			nginx.steps.push("reload");
			if (failReload && nginx.written?.value === "redirect") throw new Error("reload failed");
		},
	};
	return nginx;
};

it("loads the new default site config", async () => {
	const nginx = fakeNginx();
	await applyDefaultSite(nginx, { value: "404" }, { value: "congratulations" });
	assert.deepEqual(nginx.written, { value: "404" });
	assert.deepEqual(nginx.steps, ["generate:404", "test", "reload"]);
});

it("puts the previous config back and throws when nginx refuses the new one", async () => {
	const nginx = fakeNginx();
	await assert.rejects(applyDefaultSite(nginx, { value: "broken" }, { value: "html" }), (err) => {
		assert.equal(err.name, "ValidationError");
		assert.equal(err.cause.message, "nginx: [emerg] broken");
		return true;
	});
	assert.deepEqual(nginx.written, { value: "html" });
	assert.deepEqual(nginx.steps, ["generate:broken", "test", "generate:html", "test", "reload"]);
});

it("restores the previous config when the reload fails", async () => {
	const nginx = fakeNginx({ failReload: true });
	await assert.rejects(applyDefaultSite(nginx, { value: "redirect" }, { value: "444" }), { name: "ValidationError" });
	assert.deepEqual(nginx.written, { value: "444" });
});

it("removes the default site config when the previous one fails too", async () => {
	const nginx = fakeNginx();
	await assert.rejects(applyDefaultSite(nginx, { value: "broken" }, { value: "broken" }), {
		name: "ValidationError",
	});
	assert.equal(nginx.written, null);
	assert.deepEqual(nginx.steps, ["generate:broken", "test", "generate:broken", "test", "delete", "test", "reload"]);
});
