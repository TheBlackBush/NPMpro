import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { after, before, it } from "node:test";
import { startApi } from "./support/api.js";
import { created, fileExists } from "./support/hosts.js";

let api;
let admin;
const startAgain = async (regenerateAll) => {
	process.env.REGENERATE_ALL = String(regenerateAll);
	const { prepareApp } = await import("../startup.js");
	const reloads = api.outside.control.reloads;
	await prepareApp({ background: false });
	return api.outside.control.reloads - reloads;
};

before(async () => {
	api = await startApi({ env: { ENV_SHA512SUM: "bench-sha" } });
	admin = await api.admin();
});
after(() => api?.stop());

it("with REGENERATE_ALL a start writes every enabled host and reloads nginx once", async () => {
	const host = await created(await admin.post("/nginx/dead-hosts", { domain_names: ["regen.example.com"] }), "host");
	const file = `data/nginx/dead_host/${host.id}.conf`;
	await rm(path.join(api.root, file));
	assert.equal(await startAgain(true), 2);
	assert.equal(await fileExists(api, file), true);
	assert.equal(await api.read("data/npmpro/env.sha512sum"), "bench-sha");
});

it("without REGENERATE_ALL a missing config still comes back and the reloads stay", async () => {
	const host = await created(await admin.post("/nginx/dead-hosts", { domain_names: ["missing.example.com"] }), "host");
	const file = `data/nginx/dead_host/${host.id}.conf`;
	await rm(path.join(api.root, file));
	assert.equal(await startAgain(false), 2);
	assert.equal(await fileExists(api, file), true);
	assert.equal(await startAgain(false), 1);
});
